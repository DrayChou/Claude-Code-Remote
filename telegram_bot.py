#!/usr/bin/env python3
"""
Simple Telegram Bot for Claude Remote Control
简单的Telegram机器人用于Claude远程控制

功能:
1. 定时轮询Telegram更新
2. 转发消息到Claude PS1脚本
3. 处理回复并发送给用户
4. 智能消息分片处理长消息
"""

import asyncio
import json
import logging
import os
import subprocess
import time
from typing import Optional, List, Dict, Any
import requests
from dataclasses import dataclass
from datetime import datetime

# 配置日志
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

@dataclass
class TelegramMessage:
    """Telegram消息数据结构"""
    message_id: int
    chat_id: int
    text: str
    from_user_id: int
    from_username: str
    date: int

@dataclass
class ClaudeResponse:
    """Claude响应数据结构"""
    success: bool
    response: str
    error: Optional[str] = None
    duration: Optional[float] = None

class TelegramBot:
    """简单的Telegram机器人"""
    
    def __init__(self, bot_token: str, claude_ps1_path: str, allowed_user_ids: List[int] = None, allowed_chat_ids: List[int] = None, http_proxy: str = None):
        self.bot_token = bot_token
        self.claude_ps1_path = claude_ps1_path
        self.api_base = f"https://api.telegram.org/bot{bot_token}"
        self.last_update_id = 0
        self.max_message_length = 4096  # Telegram消息长度限制
        self.allowed_user_ids = allowed_user_ids or []
        self.allowed_chat_ids = allowed_chat_ids or []
        
        # 配置代理
        self.proxies = {}
        if http_proxy:
            self.proxies = {
                'http': http_proxy,
                'https': http_proxy
            }
            logger.info(f"使用HTTP代理: {http_proxy}")
        
        logger.info(f"初始化Telegram机器人，Claude路径: {claude_ps1_path}")
        if self.allowed_user_ids:
            logger.info(f"允许的用户ID: {self.allowed_user_ids}")
        if self.allowed_chat_ids:
            logger.info(f"允许的聊天ID: {self.allowed_chat_ids}")
    
    def get_updates(self, timeout: int = 30) -> List[Dict[str, Any]]:
        """获取Telegram更新"""
        try:
            url = f"{self.api_base}/getUpdates"
            params = {
                'offset': self.last_update_id + 1,
                'timeout': timeout,
                'limit': 100
            }
            
            response = requests.get(url, params=params, timeout=timeout + 5, proxies=self.proxies)
            response.raise_for_status()
            
            data = response.json()
            if data.get('ok'):
                updates = data.get('result', [])
                if updates:
                    self.last_update_id = updates[-1]['update_id']
                return updates
            else:
                logger.error(f"Telegram API错误: {data}")
                return []
                
        except requests.RequestException as e:
            logger.error(f"获取Telegram更新失败: {e}")
            return []
        except Exception as e:
            logger.error(f"处理Telegram更新时出错: {e}")
            return []
    
    def parse_message(self, update: Dict[str, Any]) -> Optional[TelegramMessage]:
        """解析Telegram消息"""
        try:
            if 'message' not in update:
                return None
            
            message = update['message']
            
            if 'text' not in message:
                return None
            
            return TelegramMessage(
                message_id=message['message_id'],
                chat_id=message['chat']['id'],
                text=message['text'],
                from_user_id=message['from']['id'],
                from_username=message['from'].get('username', 'unknown'),
                date=message['date']
            )
        except Exception as e:
            logger.error(f"解析消息失败: {e}")
            return None
    
    def call_claude(self, command: str, timeout: int = 60) -> ClaudeResponse:
        """调用Claude PS1脚本"""
        try:
            start_time = time.time()
            logger.info(f"调用Claude命令: {command[:100]}...")
            
            # 构建PowerShell命令
            ps_command = [
                'powershell.exe',
                '-NoProfile',
                '-ExecutionPolicy', 'Bypass',
                '-File', self.claude_ps1_path,
                command,
                '-p',
                '--output-format', 'stream-json',
                '--verbose'
            ]
            
            # 执行命令
            result = subprocess.run(
                ps_command,
                capture_output=True,
                text=True,
                timeout=timeout,
                encoding='utf-8'
            )
            
            duration = time.time() - start_time
            logger.info(f"Claude执行完成，耗时: {duration:.2f}秒")
            
            if result.returncode == 0:
                # 解析Claude响应
                response_text = self._extract_claude_response(result.stdout)
                return ClaudeResponse(
                    success=True,
                    response=response_text,
                    duration=duration
                )
            else:
                error_msg = result.stderr or "Unknown error"
                logger.error(f"Claude执行失败: {error_msg}")
                return ClaudeResponse(
                    success=False,
                    response="",
                    error=error_msg,
                    duration=duration
                )
                
        except subprocess.TimeoutExpired:
            logger.error(f"Claude执行超时 ({timeout}秒)")
            return ClaudeResponse(
                success=False,
                response="",
                error=f"Command timeout after {timeout} seconds"
            )
        except Exception as e:
            logger.error(f"调用Claude时出错: {e}")
            return ClaudeResponse(
                success=False,
                response="",
                error=str(e)
            )
    
    def _extract_claude_response(self, output: str) -> str:
        """从Claude输出中提取助手回复"""
        if not output or not output.strip():
            return "Command executed but no response received."
        
        # 尝试解析JSON流式输出
        lines = output.split('\n')
        assistant_response = ""
        
        for line in lines:
            line = line.strip()
            if not line:
                continue
                
            try:
                json_data = json.loads(line)
                
                # 提取助手消息
                if (json_data.get('type') == 'assistant' and 
                    json_data.get('message') and 
                    json_data['message'].get('content')):
                    
                    for content in json_data['message']['content']:
                        if content.get('type') == 'text' and content.get('text'):
                            assistant_response = content['text']
                            break
                    
                    if assistant_response:
                        break
                
                # 从结果中提取回复
                if (json_data.get('type') == 'result' and 
                    json_data.get('subtype') == 'success' and 
                    json_data.get('result')):
                    if not assistant_response:
                        assistant_response = json_data['result']
                        
            except json.JSONDecodeError:
                continue
        
        # 如果没有找到JSON格式的回复，使用文本清理
        if not assistant_response:
            clean_lines = []
            found_content = False
            
            for line in lines:
                clean_line = line.strip()
                
                # 跳过系统消息和PowerShell输出
                if (clean_line.startswith('"type":"system"') or
                    'Executing:' in clean_line or
                    'Node.js' in clean_line or
                    'DEP0190' in clean_line or
                    'DeprecationWarning' in clean_line or
                    'Windows PowerShell' in clean_line or
                    '版权所有' in clean_line or
                    clean_line.startswith('Microsoft') or
                    clean_line.startswith('执行完成') or
                    not clean_line):
                    continue
                
                if not found_content and clean_line:
                    found_content = True
                
                if found_content:
                    clean_lines.append(clean_line)
            
            assistant_response = '\n'.join(clean_lines).strip()
        
        # 如果仍然没有内容，返回默认消息
        if not assistant_response:
            if output:
                # 返回输出摘要
                summary = ' '.join(output.split()).strip()
                assistant_response = (summary[:200] + '...') if len(summary) > 200 else summary
            else:
                assistant_response = "Command executed but no response received."
        
        return assistant_response
    
    def split_message(self, text: str) -> List[str]:
        """智能分割长消息"""
        if len(text) <= self.max_message_length:
            return [text]
        
        parts = []
        remaining = text
        
        # 定义分割优先级
        split_patterns = [
            '\n\n',  # 双换行（段落）
            '\n',    # 单换行
            '. ',    # 句号
            ', ',    # 逗号
            ' '      # 空格
        ]
        
        while remaining:
            if len(remaining) <= self.max_message_length:
                parts.append(remaining)
                break
            
            # 寻找最佳分割点
            best_split = self.max_message_length
            
            for pattern in split_patterns:
                # 在限制范围内寻找最后一个分割点
                chunk = remaining[:self.max_message_length]
                last_index = chunk.rfind(pattern)
                
                if last_index > self.max_message_length // 2:  # 确保分割点不太靠前
                    best_split = last_index + len(pattern)
                    break
            
            # 分割消息
            part = remaining[:best_split].rstrip()
            parts.append(part)
            remaining = remaining[best_split:].lstrip()
        
        return parts
    
    def send_message(self, chat_id: int, text: str, reply_to_message_id: Optional[int] = None) -> bool:
        """发送消息到Telegram"""
        try:
            url = f"{self.api_base}/sendMessage"
            data = {
                'chat_id': chat_id,
                'text': text,
                'parse_mode': 'Markdown'
            }
            
            if reply_to_message_id:
                data['reply_to_message_id'] = reply_to_message_id
            
            response = requests.post(url, json=data, timeout=30, proxies=self.proxies)
            response.raise_for_status()
            
            result = response.json()
            if result.get('ok'):
                logger.info(f"消息发送成功到聊天 {chat_id}")
                return True
            else:
                logger.error(f"Telegram发送消息失败: {result}")
                return False
                
        except Exception as e:
            logger.error(f"发送消息时出错: {e}")
            return False
    
    def send_long_message(self, chat_id: int, text: str, reply_to_message_id: Optional[int] = None) -> bool:
        """发送长消息（自动分片）"""
        try:
            parts = self.split_message(text)
            
            if len(parts) == 1:
                # 单条消息
                return self.send_message(chat_id, text, reply_to_message_id)
            
            # 多条消息分片发送
            success_count = 0
            for i, part in enumerate(parts, 1):
                # 添加分片信息
                if len(parts) > 1:
                    header = f"**[{i}/{len(parts)}]**\n\n"
                    message_text = header + part
                else:
                    message_text = part
                
                # 只在第一条消息中回复原消息
                reply_id = reply_to_message_id if i == 1 else None
                
                if self.send_message(chat_id, message_text, reply_id):
                    success_count += 1
                    
                    # 消息间短暂延迟避免频率限制
                    if i < len(parts):
                        time.sleep(0.5)
                else:
                    logger.error(f"发送第{i}部分消息失败")
            
            logger.info(f"长消息分片发送完成: {success_count}/{len(parts)} 成功")
            return success_count == len(parts)
            
        except Exception as e:
            logger.error(f"发送长消息时出错: {e}")
            return False
    
    def is_authorized(self, message: TelegramMessage) -> bool:
        """检查用户是否有权限"""
        # 如果没有设置限制，允许所有用户
        if not self.allowed_user_ids and not self.allowed_chat_ids:
            return True
        
        # 检查用户ID
        if self.allowed_user_ids and message.from_user_id in self.allowed_user_ids:
            return True
        
        # 检查聊天ID
        if self.allowed_chat_ids and message.chat_id in self.allowed_chat_ids:
            return True
        
        return False
    
    def process_message(self, message: TelegramMessage) -> bool:
        """处理单条消息"""
        try:
            logger.info(f"处理来自 @{message.from_username} (ID:{message.from_user_id}) 的消息: {message.text[:50]}...")
            
            # 检查权限
            if not self.is_authorized(message):
                logger.warning(f"用户 @{message.from_username} (ID:{message.from_user_id}) 无权限")
                error_text = "❌ 您无权限使用此机器人"
                return self.send_message(
                    chat_id=message.chat_id,
                    text=error_text,
                    reply_to_message_id=message.message_id
                )
            
            # 调用Claude
            claude_response = self.call_claude(message.text)
            
            if claude_response.success:
                # 发送回复
                response_text = claude_response.response
                logger.info(f"准备发送回复 ({len(response_text)} 字符)")
                
                return self.send_long_message(
                    chat_id=message.chat_id,
                    text=response_text,
                    reply_to_message_id=message.message_id
                )
            else:
                # 发送错误消息
                error_text = f"❌ Claude执行失败: {claude_response.error}"
                return self.send_message(
                    chat_id=message.chat_id,
                    text=error_text,
                    reply_to_message_id=message.message_id
                )
                
        except Exception as e:
            logger.error(f"处理消息时出错: {e}")
            return False
    
    async def run(self, poll_interval: int = 2):
        """运行机器人主循环"""
        logger.info("Telegram机器人启动")
        logger.info(f"轮询间隔: {poll_interval}秒")
        
        while True:
            try:
                # 获取更新
                updates = self.get_updates()
                
                if updates:
                    logger.info(f"收到 {len(updates)} 条更新")
                    
                    for update in updates:
                        message = self.parse_message(update)
                        if message:
                            # 处理消息
                            self.process_message(message)
                        else:
                            logger.debug("跳过非文本消息或无效更新")
                
                # 等待下次轮询
                await asyncio.sleep(poll_interval)
                
            except KeyboardInterrupt:
                logger.info("收到中断信号，停止机器人")
                break
            except Exception as e:
                logger.error(f"机器人运行时出错: {e}")
                await asyncio.sleep(poll_interval)

def load_config() -> Dict[str, Any]:
    """从.env文件加载配置"""
    from dotenv import load_dotenv
    
    # 加载.env文件
    load_dotenv()
    
    config = {
        'bot_token': os.getenv('TELEGRAM_BOT_TOKEN'),
        'claude_ps1_path': os.getenv('CLAUDE_CLI_PATH', 'claude'),
        'poll_interval': int(os.getenv('POLL_INTERVAL', '2')),
        'claude_timeout': int(os.getenv('CLAUDE_TIMEOUT', '60')),
        'log_level': os.getenv('LOG_LEVEL', 'INFO'),
        'http_proxy': os.getenv('HTTP_PROXY'),
        'allowed_user_ids': [],
        'allowed_chat_ids': []
    }
    
    # 解析允许的用户ID列表
    if os.getenv('ALLOWED_USER_IDS'):
        try:
            config['allowed_user_ids'] = [int(x.strip()) for x in os.getenv('ALLOWED_USER_IDS').split(',') if x.strip()]
        except ValueError:
            logger.warning("ALLOWED_USER_IDS 格式错误，将忽略用户限制")
    
    # 解析允许的聊天ID列表
    if os.getenv('ALLOWED_CHAT_IDS'):
        try:
            config['allowed_chat_ids'] = [int(x.strip()) for x in os.getenv('ALLOWED_CHAT_IDS').split(',') if x.strip()]
        except ValueError:
            logger.warning("ALLOWED_CHAT_IDS 格式错误，将忽略聊天限制")
    
    # 验证必需的配置
    if not config['bot_token']:
        raise ValueError("未设置 TELEGRAM_BOT_TOKEN 环境变量，请检查.env文件")
    
    if not config['claude_ps1_path']:
        raise ValueError("未设置 CLAUDE_CLI_PATH 环境变量，请检查.env文件")
    
    return config

async def main():
    """主函数"""
    try:
        # 加载配置
        config = load_config()
        
        # 设置日志级别
        log_level = getattr(logging, config['log_level'].upper(), logging.INFO)
        logging.getLogger().setLevel(log_level)
        
        logger.info("配置加载完成:")
        logger.info(f"  Claude路径: {config['claude_ps1_path']}")
        logger.info(f"  轮询间隔: {config['poll_interval']}秒")
        logger.info(f"  Claude超时: {config['claude_timeout']}秒")
        logger.info(f"  日志级别: {config['log_level']}")
        if config['http_proxy']:
            logger.info(f"  HTTP代理: {config['http_proxy']}")
        
        # 创建机器人
        bot = TelegramBot(
            bot_token=config['bot_token'],
            claude_ps1_path=config['claude_ps1_path'],
            allowed_user_ids=config['allowed_user_ids'],
            allowed_chat_ids=config['allowed_chat_ids'],
            http_proxy=config['http_proxy']
        )
        
        # 运行机器人
        await bot.run(poll_interval=config['poll_interval'])
        
    except Exception as e:
        logger.error(f"程序启动失败: {e}")
        return 1

if __name__ == "__main__":
    asyncio.run(main())