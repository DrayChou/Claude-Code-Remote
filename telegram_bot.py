#!/usr/bin/env python3
"""
Simple Telegram Bot for Claude Remote Control
简单的Telegram机器人用于Claude远程控制

功能:
1. 定时轮询Telegram更新
2. 转发消息到Claude PS1脚本
3. 处理回复并发送给用户
4. 智能消息分片处理长消息
5. 流式响应支持
6. 内容格式化和清理
"""

import argparse
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
    
    def __init__(self, bot_token: str, claude_ps1_path: str, allowed_user_ids: List[int] = None, allowed_chat_ids: List[int] = None, http_proxy: str = None, claude_working_dir: str = None):
        self.bot_token = bot_token
        self.claude_ps1_path = claude_ps1_path
        self.claude_working_dir = claude_working_dir
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
        if self.claude_working_dir:
            logger.info(f"Claude工作目录: {self.claude_working_dir}")
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
            
            # 构建PowerShell命令 - 强制UTF-8编码
            # 构建cd命令（如果指定了工作目录）
            cd_command = ""
            if self.claude_working_dir:
                cd_command = f'cd "{self.claude_working_dir}"; '
            
            ps_command = [
                'powershell.exe',
                '-NoProfile',
                '-ExecutionPolicy', 'Bypass',
                '-Command', f'''
                    [Console]::OutputEncoding = [Console]::InputEncoding = [System.Text.Encoding]::UTF8;
                    {cd_command}& "{self.claude_ps1_path}" "{command}" -p --output-format stream-json --verbose
                '''.replace('\n', ' ').strip()
            ]
            
            # 执行命令 - 使用二进制模式避免编码问题
            result = subprocess.run(
                ps_command,
                capture_output=True,
                timeout=timeout
            )
            
            # 手动解码输出，尝试多种编码
            def decode_output(raw_bytes, output_type="output"):
                if not raw_bytes:
                    return ""
                
                # 尝试多种编码
                encodings = ['utf-8', 'gbk', 'cp1252', 'ascii']
                
                for encoding in encodings:
                    try:
                        decoded = raw_bytes.decode(encoding)
                        logger.debug(f"成功使用 {encoding} 编码解码 {output_type}")
                        return decoded
                    except UnicodeDecodeError as e:
                        logger.debug(f"使用 {encoding} 编码解码 {output_type} 失败: {e}")
                        continue
                
                # 如果所有编码都失败，使用utf-8并替换错误字符
                logger.warning(f"所有编码都失败，使用UTF-8强制解码 {output_type}")
                return raw_bytes.decode('utf-8', errors='replace')
            
            # 解码stdout和stderr
            stdout_text = decode_output(result.stdout, "stdout")
            stderr_text = decode_output(result.stderr, "stderr")
            
            logger.debug(f"PowerShell命令: {' '.join(ps_command)}")
            logger.debug(f"返回码: {result.returncode}")
            logger.debug(f"stdout长度: {len(stdout_text)}")
            logger.debug(f"stderr长度: {len(stderr_text)}")
            
            duration = time.time() - start_time
            logger.info(f"Claude执行完成，耗时: {duration:.2f}秒")
            
            if result.returncode == 0:
                # 记录Claude原始输出
                logger.info(f"Claude原始stdout: {repr(stdout_text[:500])}{'...' if len(stdout_text) > 500 else ''}")
                if stderr_text:
                    logger.info(f"Claude原始stderr: {repr(stderr_text[:200])}{'...' if len(stderr_text) > 200 else ''}")
                
                # 解析Claude响应
                response_text = self._extract_claude_response(stdout_text)
                logger.info(f"解析后的Claude响应: {repr(response_text[:200])}{'...' if len(response_text) > 200 else ''}")
                
                return ClaudeResponse(
                    success=True,
                    response=response_text,
                    duration=duration
                )
            else:
                error_msg = stderr_text or "Unknown error"
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
        assistant_response_parts = []
        final_result = ""
        
        for line in lines:
            line = line.strip()
            if not line:
                continue
                
            try:
                json_data = json.loads(line)
                
                # 累积助手消息内容（流式输出的每一部分）
                if (json_data.get('type') == 'assistant' and 
                    json_data.get('message') and 
                    json_data['message'].get('content')):
                    
                    for content in json_data['message']['content']:
                        if content.get('type') == 'text' and content.get('text'):
                            assistant_response_parts.append(content['text'])
                
                # 从结果中提取最终回复
                if (json_data.get('type') == 'result' and 
                    json_data.get('subtype') == 'success' and 
                    json_data.get('result')):
                    final_result = json_data['result']
                        
            except json.JSONDecodeError:
                continue
        
        # 优先使用累积的助手消息，如果没有则使用最终结果
        if assistant_response_parts:
            assistant_response = ''.join(assistant_response_parts)
        elif final_result:
            assistant_response = final_result
        else:
            assistant_response = ""
        
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
        
        # 最终清理响应内容
        assistant_response = self._clean_response_content(assistant_response)
        return assistant_response
    
    def _format_response_content(self, content: str) -> str:
        """格式化回复内容，提升可读性"""
        if not content:
            return ""
        
        import re
        
        # 首先清理基础内容
        content = self._clean_response_content(content)
        
        # 1. 按行分割并处理
        lines = content.split('\n')
        formatted_lines = []
        in_list = False
        
        for line in lines:
            line = line.strip()
            if not line:
                # 空行处理
                if formatted_lines and formatted_lines[-1] != "":
                    formatted_lines.append("")
                continue
            
            # 识别数字列表 (1. 2. 3.)
            if re.match(r'^\d+\.\s+', line):
                if not in_list:
                    formatted_lines.append("")  # 列表前加空行
                    in_list = True
                # 提取列表内容
                list_content = line[line.find('.')+1:].strip()
                formatted_lines.append(f"📋 {list_content}")
            
            # 识别项目符号 (* - •)
            elif line.startswith(('*', '-', '•')):
                if not in_list:
                    formatted_lines.append("")  # 列表前加空行
                    in_list = True
                bullet_content = line[1:].strip()
                formatted_lines.append(f"• {bullet_content}")
            
            # 识别标题 (**标题** 或 ## 标题)
            elif '**' in line or line.startswith('#'):
                if in_list:
                    in_list = False
                # 清理标题格式
                title = re.sub(r'\*\*([^*]+)\*\*', r'\1', line)  # 移除**加粗**
                title = re.sub(r'^#+\s*', '', title)  # 移除#标记
                formatted_lines.append(f"\n📌 {title}\n")
            
            # 检测中英文混合的句子，适当分隔
            elif self._is_mixed_language(line):
                if in_list:
                    in_list = False
                    formatted_lines.append("")
                # 按中英文逻辑分隔句子
                sentences = self._split_mixed_sentences(line)
                formatted_lines.extend(sentences)
            
            else:
                if in_list:
                    in_list = False
                    formatted_lines.append("")
                formatted_lines.append(line)
        
        # 2. 重新组合内容，优化换行
        formatted_content = '\n'.join(formatted_lines)
        
        # 3. 清理多余的空行
        formatted_content = re.sub(r'\n{3,}', '\n\n', formatted_content)
        formatted_content = re.sub(r'^\n+|\n+$', '', formatted_content)
        
        return formatted_content.strip()
    
    def _is_mixed_language(self, text: str) -> bool:
        """检测是否包含中英文混合"""
        if not text:
            return False
        
        has_chinese = any('\u4e00' <= char <= '\u9fff' for char in text)
        has_english = any('a' <= char.lower() <= 'z' for char in text)
        
        return has_chinese and has_english
    
    def _split_mixed_sentences(self, text: str) -> list:
        """智能分割中英文混合句子"""
        import re
        
        # 按句号、感叹号、问号分割，但要保持中英文逻辑
        sentences = []
        
        # 尝试按常见中英文标点分割
        parts = re.split(r'([。！？.!?])', text)
        
        current_sentence = ""
        for i in range(0, len(parts), 2):
            sentence_part = parts[i]
            punctuation = parts[i+1] if i+1 < len(parts) else ""
            
            current_sentence += sentence_part + punctuation
            
            # 如果句子长度合适，或者遇到明确的结束标志，就分割
            if (len(current_sentence.strip()) > 20 and punctuation in ['。', '！', '？', '.', '!', '?']) or \
               (len(current_sentence.strip()) > 50):
                if current_sentence.strip():
                    sentences.append(current_sentence.strip())
                current_sentence = ""
        
        # 添加剩余部分
        if current_sentence.strip():
            sentences.append(current_sentence.strip())
        
        return sentences if sentences else [text]
    
    def _clean_response_content(self, content: str) -> str:
        """清理回复内容，移除无效或重复的部分"""
        if not content:
            return ""
        
        # 首先移除所有的 "(no content)" 出现
        import re
        content = re.sub(r'\(no content\)', '', content)
        content = re.sub(r'no content', '', content)
        
        # 按行分割内容
        lines = content.split('\n')
        cleaned_lines = []
        
        for line in lines:
            line = line.strip()
            
            # 跳过空行和无效内容
            if not line:
                continue
                
            # 过滤掉常见的无效内容
            if (line.startswith("Executing:") or
                line.startswith("Node.js") or
                "DeprecationWarning" in line or
                "DEP0190" in line or
                line.startswith("Windows PowerShell") or
                line.startswith("Microsoft") or
                line.startswith("版权所有")):
                continue
            
            # 避免重复行
            if cleaned_lines and cleaned_lines[-1] == line:
                continue
                
            cleaned_lines.append(line)
        
        # 重新组合内容
        cleaned_content = '\n'.join(cleaned_lines).strip()
        
        # 清理多余的空白字符
        cleaned_content = re.sub(r'\n\s*\n', '\n', cleaned_content)  # 移除多余的空行
        cleaned_content = re.sub(r'^\s+|\s+$', '', cleaned_content)  # 移除首尾空白
            
        return cleaned_content
    
    def call_claude_streaming(self, command: str, chat_id: int, reply_to_message_id: int, timeout: int = 60) -> bool:
        """调用Claude并实时更新Telegram消息"""
        try:
            start_time = time.time()
            logger.info(f"调用Claude流式命令: {command[:100]}...")
            
            # 先发送一个初始消息
            initial_message = "🤔 正在思考..."
            sent_message_id = self.send_message_plain(chat_id, initial_message, reply_to_message_id)
            if not sent_message_id:
                return False
            
            # 构建PowerShell命令
            # 构建cd命令（如果指定了工作目录）
            cd_command = ""
            if self.claude_working_dir:
                cd_command = f'cd "{self.claude_working_dir}"; '
            
            ps_command = [
                'powershell.exe',
                '-NoProfile',
                '-ExecutionPolicy', 'Bypass',
                '-Command', f'''
                    [Console]::OutputEncoding = [Console]::InputEncoding = [System.Text.Encoding]::UTF8;
                    {cd_command}& "{self.claude_ps1_path}" "{command}" -p --output-format stream-json --verbose
                '''.replace('\n', ' ').strip()
            ]
            
            # 启动进程并实时读取输出
            process = subprocess.Popen(
                ps_command,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                text=True,
                encoding='utf-8',
                bufsize=1,
                universal_newlines=True
            )
            
            assistant_response_parts = []
            last_edit_time = 0
            edit_interval = 3  # 每3秒更新一次消息（避免频率限制）
            last_content = ""  # 记录上次编辑的内容，避免重复编辑
            
            # 实时读取输出
            while True:
                output_line = process.stdout.readline()
                if output_line == '' and process.poll() is not None:
                    break
                    
                if output_line:
                    line = output_line.strip()
                    if not line:
                        continue
                    
                    try:
                        json_data = json.loads(line)
                        
                        # 检查是否是助手消息
                        if (json_data.get('type') == 'assistant' and 
                            json_data.get('message') and 
                            json_data['message'].get('content')):
                            
                            for content in json_data['message']['content']:
                                if content.get('type') == 'text' and content.get('text'):
                                    text_content = content['text']
                                    # 清理内容后再添加
                                    cleaned_text = self._clean_response_content(text_content)
                                    if cleaned_text:  # 只添加有效内容
                                        assistant_response_parts.append(cleaned_text)
                                    
                                    # 每隔一定时间更新消息
                                    current_time = time.time()
                                    if current_time - last_edit_time > edit_interval:
                                        current_response = ''.join(assistant_response_parts)
                                        current_response = self._format_response_content(current_response)
                                        
                                        # 确保有足够内容且与上次内容不同
                                        if (current_response.strip() and 
                                            len(current_response.strip()) > 10 and 
                                            current_response != last_content):
                                            
                                            success = self.edit_message_plain(chat_id, sent_message_id, current_response)
                                            if success:
                                                last_edit_time = current_time
                                                last_content = current_response
                                                logger.debug(f"成功更新流式消息，长度: {len(current_response)}")
                                            else:
                                                logger.warning("流式消息更新失败，将在下个周期重试")
                                            
                    except json.JSONDecodeError:
                        continue
            
            # 等待进程完成
            stderr_output = process.stderr.read()
            return_code = process.wait()
            
            duration = time.time() - start_time
            logger.info(f"Claude流式执行完成，耗时: {duration:.2f}秒")
            
            # 发送最终消息
            final_response = ''.join(assistant_response_parts)
            final_response = self._format_response_content(final_response)
            if final_response.strip():
                # 避免重复编辑相同内容
                if final_response != last_content:
                    success = self.edit_message_plain(chat_id, sent_message_id, final_response)
                    if success:
                        logger.info(f"最终回复内容长度: {len(final_response)} 字符")
                        return True
                    else:
                        # 编辑失败，尝试发送新消息作为回退
                        logger.warning("最终消息编辑失败，尝试发送新消息")
                        new_msg_id = self.send_message_plain(chat_id, final_response, reply_to_message_id)
                        return new_msg_id is not None
                else:
                    logger.info("最终内容与上次更新相同，无需重复编辑")
                    return True
            else:
                # 如果没有有效回复，尝试从输出中提取有用信息
                if return_code == 0:
                    # 使用原有的解析逻辑处理输出
                    full_output = process.stdout.read() if hasattr(process, 'stdout') else ""
                    claude_response = self.call_claude(command)
                    if claude_response.success and claude_response.response.strip():
                        self.edit_message_plain(chat_id, sent_message_id, claude_response.response)
                        return True
                
                # 如果仍然没有有效回复，显示错误
                error_msg = "❌ 未收到有效回复"
                if stderr_output:
                    error_msg += f"\n错误信息: {stderr_output[:200]}"
                self.edit_message_plain(chat_id, sent_message_id, error_msg)
                return False
                
        except subprocess.TimeoutExpired:
            logger.error(f"Claude流式执行超时 ({timeout}秒)")
            if 'sent_message_id' in locals():
                self.edit_message_plain(chat_id, sent_message_id, f"❌ 执行超时 ({timeout}秒)")
            return False
        except Exception as e:
            logger.error(f"调用Claude流式时出错: {e}")
            if 'sent_message_id' in locals():
                self.edit_message_plain(chat_id, sent_message_id, f"❌ 执行出错: {str(e)}")
            return False
    
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
    
    def edit_message(self, chat_id: int, message_id: int, text: str) -> bool:
        """编辑已发送的消息"""
        try:
            url = f"{self.api_base}/editMessageText"
            data = {
                'chat_id': chat_id,
                'message_id': message_id,
                'text': text,
                'parse_mode': 'Markdown'
            }
            
            response = requests.post(url, json=data, timeout=30, proxies=self.proxies)
            response.raise_for_status()
            
            result = response.json()
            if result.get('ok'):
                return True
            else:
                logger.error(f"Telegram编辑消息失败: {result}")
                return False
                
        except Exception as e:
            logger.error(f"编辑消息时出错: {e}")
            return False

    def edit_message_plain(self, chat_id: int, message_id: int, text: str) -> bool:
        """编辑已发送的消息（纯文本，无Markdown）"""
        try:
            # 验证和清理输入参数
            if not text or not text.strip():
                logger.warning("尝试编辑空消息，跳过")
                return False
                
            # 限制消息长度
            if len(text) > 4096:
                text = text[:4093] + "..."
                logger.info(f"消息内容过长，截断到 {len(text)} 字符")
            
            url = f"{self.api_base}/editMessageText"
            data = {
                'chat_id': chat_id,
                'message_id': message_id,
                'text': text
            }
            
            logger.debug(f"编辑消息请求: chat_id={chat_id}, message_id={message_id}, text_length={len(text)}")
            logger.info(f"要编辑的消息内容: {repr(text)}")
            
            response = requests.post(url, json=data, timeout=30, proxies=self.proxies)
            
            if response.status_code != 200:
                logger.error(f"Telegram API返回状态码: {response.status_code}")
                logger.error(f"响应内容: {response.text}")
                return False
            
            result = response.json()
            if result.get('ok'):
                return True
            else:
                logger.error(f"Telegram编辑纯文本消息失败: {result}")
                logger.error(f"错误详情: {result.get('description', 'Unknown error')}")
                return False
                
        except requests.exceptions.RequestException as e:
            logger.error(f"编辑纯文本消息网络错误: {e}")
            return False
        except Exception as e:
            logger.error(f"编辑纯文本消息时出错: {e}")
            logger.error(f"消息内容预览: {repr(text[:100])}...")
            return False

    def send_message(self, chat_id: int, text: str, reply_to_message_id: Optional[int] = None) -> Optional[int]:
        """发送消息到Telegram，返回消息ID"""
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
                message_id = result['result']['message_id']
                logger.info(f"消息发送成功到聊天 {chat_id}，消息ID: {message_id}")
                return message_id
            else:
                logger.error(f"Telegram发送消息失败: {result}")
                return None
                
        except Exception as e:
            logger.error(f"发送消息时出错: {e}")
            return None

    def send_message_plain(self, chat_id: int, text: str, reply_to_message_id: Optional[int] = None) -> Optional[int]:
        """发送纯文本消息到Telegram（无Markdown），返回消息ID"""
        try:
            logger.info(f"发送纯文本消息内容: {repr(text)}")
            
            url = f"{self.api_base}/sendMessage"
            data = {
                'chat_id': chat_id,
                'text': text
            }
            
            if reply_to_message_id:
                data['reply_to_message_id'] = reply_to_message_id
            
            response = requests.post(url, json=data, timeout=30, proxies=self.proxies)
            response.raise_for_status()
            
            result = response.json()
            if result.get('ok'):
                message_id = result['result']['message_id']
                logger.info(f"纯文本消息发送成功到聊天 {chat_id}，消息ID: {message_id}")
                return message_id
            else:
                logger.error(f"Telegram发送纯文本消息失败: {result}")
                return None
                
        except Exception as e:
            logger.error(f"发送纯文本消息时出错: {e}")
            return None
    
    def send_long_message(self, chat_id: int, text: str, reply_to_message_id: Optional[int] = None) -> bool:
        """发送长消息（自动分片）"""
        try:
            parts = self.split_message(text)
            
            if len(parts) == 1:
                # 单条消息
                message_id = self.send_message(chat_id, text, reply_to_message_id)
                return message_id is not None
            
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
                
                sent_id = self.send_message(chat_id, message_text, reply_id)
                if sent_id:
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
            
            # 特殊命令：/id - 显示用户和聊天ID（无需权限验证）
            if message.text.lower().strip() in ['/id', 'id', '#id']:
                id_info = f"用户ID: {message.from_user_id}\n聊天ID: {message.chat_id}"
                if message.from_username:
                    id_info += f"\n用户名: @{message.from_username}"
                
                logger.info(f"响应ID查询命令给用户 @{message.from_username}")
                message_id = self.send_message_plain(
                    chat_id=message.chat_id,
                    text=id_info,
                    reply_to_message_id=message.message_id
                )
                return message_id is not None
            
            # 检查权限
            if not self.is_authorized(message):
                logger.warning(f"用户 @{message.from_username} (ID:{message.from_user_id}) 无权限，忽略消息")
                return True  # 静默忽略，不发送任何回复
            
            # 调用Claude流式处理
            return self.call_claude_streaming(
                command=message.text,
                chat_id=message.chat_id,
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

def parse_args() -> argparse.Namespace:
    """解析命令行参数"""
    parser = argparse.ArgumentParser(
        description="Telegram机器人用于Claude远程控制",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
示例用法:
  python telegram_bot.py
  python telegram_bot.py --claude-working-dir "D:\\Code\\MyProject"
  python telegram_bot.py --claude-cli-path "C:\\path\\to\\claude.ps1" --working-dir "D:\\workspace"
  python telegram_bot.py --bot-token "your_token" --proxy "http://127.0.0.1:7890"
        """
    )
    
    parser.add_argument('--bot-token', 
                        help='Telegram Bot Token (覆盖 TELEGRAM_BOT_TOKEN)')
    parser.add_argument('--claude-cli-path', 
                        help='Claude CLI路径 (覆盖 CLAUDE_CLI_PATH)')
    parser.add_argument('--claude-working-dir', '--working-dir',
                        help='Claude执行工作目录 (覆盖 CLAUDE_WORKING_DIR)')
    parser.add_argument('--proxy', 
                        help='HTTP代理地址 (覆盖 HTTP_PROXY)')
    parser.add_argument('--poll-interval', type=int,
                        help='轮询间隔秒数 (覆盖 POLL_INTERVAL)')
    parser.add_argument('--claude-timeout', type=int,
                        help='Claude执行超时秒数 (覆盖 CLAUDE_TIMEOUT)')
    parser.add_argument('--log-level', 
                        choices=['DEBUG', 'INFO', 'WARNING', 'ERROR'],
                        help='日志级别 (覆盖 LOG_LEVEL)')
    parser.add_argument('--allowed-user-ids',
                        help='允许的用户ID列表，逗号分隔 (覆盖 ALLOWED_USER_IDS)')
    parser.add_argument('--allowed-chat-ids',
                        help='允许的聊天ID列表，逗号分隔 (覆盖 ALLOWED_CHAT_IDS)')
    
    return parser.parse_args()

def load_config() -> Dict[str, Any]:
    """从.env文件和命令行参数加载配置"""
    from dotenv import load_dotenv
    
    # 解析命令行参数
    args = parse_args()
    
    # 加载.env文件
    load_dotenv()
    
    # 基础配置（优先级：命令行参数 > 环境变量 > 默认值）
    config = {
        'bot_token': args.bot_token or os.getenv('TELEGRAM_BOT_TOKEN'),
        'claude_ps1_path': args.claude_cli_path or os.getenv('CLAUDE_CLI_PATH', 'claude'),
        'claude_working_dir': args.claude_working_dir or os.getenv('CLAUDE_WORKING_DIR'),
        'poll_interval': args.poll_interval or int(os.getenv('POLL_INTERVAL', '2')),
        'claude_timeout': args.claude_timeout or int(os.getenv('CLAUDE_TIMEOUT', '60')),
        'log_level': args.log_level or os.getenv('LOG_LEVEL', 'INFO'),
        'http_proxy': args.proxy or os.getenv('HTTP_PROXY'),
        'allowed_user_ids': [],
        'allowed_chat_ids': []
    }
    
    # 解析允许的用户ID列表（优先使用命令行参数）
    user_ids_source = args.allowed_user_ids or os.getenv('ALLOWED_USER_IDS')
    if user_ids_source:
        try:
            config['allowed_user_ids'] = [int(x.strip()) for x in user_ids_source.split(',') if x.strip()]
        except ValueError:
            logger.warning("ALLOWED_USER_IDS 格式错误，将忽略用户限制")
    
    # 解析允许的聊天ID列表（优先使用命令行参数）
    chat_ids_source = args.allowed_chat_ids or os.getenv('ALLOWED_CHAT_IDS')
    if chat_ids_source:
        try:
            config['allowed_chat_ids'] = [int(x.strip()) for x in chat_ids_source.split(',') if x.strip()]
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
        if config['claude_working_dir']:
            logger.info(f"  Claude工作目录: {config['claude_working_dir']}")
        logger.info(f"  轮询间隔: {config['poll_interval']}秒")
        logger.info(f"  Claude超时: {config['claude_timeout']}秒")
        logger.info(f"  日志级别: {config['log_level']}")
        if config['http_proxy']:
            logger.info(f"  HTTP代理: {config['http_proxy']}")
        if config['allowed_user_ids']:
            logger.info(f"  允许的用户ID: {config['allowed_user_ids']}")
        if config['allowed_chat_ids']:
            logger.info(f"  允许的聊天ID: {config['allowed_chat_ids']}")
        
        # 创建机器人
        bot = TelegramBot(
            bot_token=config['bot_token'],
            claude_ps1_path=config['claude_ps1_path'],
            allowed_user_ids=config['allowed_user_ids'],
            allowed_chat_ids=config['allowed_chat_ids'],
            http_proxy=config['http_proxy'],
            claude_working_dir=config['claude_working_dir']
        )
        
        # 运行机器人
        await bot.run(poll_interval=config['poll_interval'])
        
    except Exception as e:
        logger.error(f"程序启动失败: {e}")
        return 1

if __name__ == "__main__":
    asyncio.run(main())