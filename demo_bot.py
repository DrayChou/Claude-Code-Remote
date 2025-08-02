#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
演示脚本 - 测试 Claude 调用和消息分片功能
不需要真实的 Telegram Bot Token
"""

import os
import sys
from dotenv import load_dotenv
from telegram_bot import TelegramBot, TelegramMessage

def demo_message_splitting():
    """演示消息分片功能"""
    print("=" * 50)
    print("演示消息分片功能")
    print("=" * 50)
    
    bot = TelegramBot("demo_token", "demo_path")
    
    # 创建一个超长消息
    long_message = """
这是一个很长的Claude回复示例。

## 第一部分
Claude是一个AI助手，可以帮助您处理各种任务，包括：
- 编程和代码调试
- 文档编写和翻译
- 数据分析和可视化
- 创意写作和内容创作

## 第二部分
我可以帮助您：
1. 解答技术问题
2. 编写和调试代码
3. 分析数据和文档
4. 提供创意建议

## 第三部分
在这个Telegram机器人中，我的功能包括：
- 接收您的消息并理解需求
- 调用本地Claude CLI处理请求
- 将回复智能分片后发送回Telegram
- 保持对话的连续性和上下文

## 第四部分
一些使用建议：
- 尽量使用清晰具体的问题
- 如果需要代码，请说明编程语言
- 复杂任务可以分步骤提问
- 我会尽力提供准确有用的回答

这个消息足够长，应该会被分片处理。
""" * 3  # 重复3次使其足够长
    
    # 分片测试
    parts = bot.split_message(long_message)
    
    print(f"原始消息长度: {len(long_message)} 字符")
    print(f"分片数量: {len(parts)}")
    print()
    
    for i, part in enumerate(parts, 1):
        print(f"第 {i} 部分 ({len(part)} 字符):")
        print("-" * 30)
        preview = part[:200] + "..." if len(part) > 200 else part
        print(preview)
        print()

def demo_claude_response_extraction():
    """演示Claude响应提取"""
    print("=" * 50)
    print("演示Claude响应提取功能")
    print("=" * 50)
    
    bot = TelegramBot("demo_token", "demo_path")
    
    # 模拟Claude的JSON输出
    json_output = '''
{"type":"system","subtype":"init","message":"Initializing Claude..."}
{"type":"assistant","message":{"content":[{"type":"text","text":"你好！我是Claude，一个AI助手。我可以帮助您解决各种问题，包括编程、写作、分析等。有什么我可以帮助您的吗？"}]}}
{"type":"result","subtype":"success","result":"Response completed"}
'''
    
    extracted = bot._extract_claude_response(json_output)
    print("JSON格式输出提取结果:")
    print(f"提取的回复: {extracted}")
    print()
    
    # 模拟纯文本输出
    text_output = '''
Windows PowerShell
版权所有 (C) Microsoft Corporation
执行完成
我理解您的问题。这是一个关于Python编程的询问。

让我为您提供一个简单的示例：

```python
def hello_world():
    print("Hello, World!")

hello_world()
```

这个函数定义了一个简单的打招呼功能。
'''
    
    extracted_text = bot._extract_claude_response(text_output)
    print("纯文本输出提取结果:")
    print(f"提取的回复: {extracted_text}")

def demo_security_check():
    """演示安全检查功能"""
    print("=" * 50)
    print("演示安全检查功能")
    print("=" * 50)
    
    # 带权限限制的机器人
    bot = TelegramBot("demo_token", "demo_path", 
                     allowed_user_ids=[123456789], 
                     allowed_chat_ids=[-1001234567890])
    
    # 模拟消息
    authorized_message = TelegramMessage(
        message_id=1,
        chat_id=123456789,
        text="测试消息",
        from_user_id=123456789,
        from_username="authorized_user",
        date=1234567890
    )
    
    unauthorized_message = TelegramMessage(
        message_id=2,
        chat_id=999999999,
        text="测试消息",
        from_user_id=999999999,
        from_username="unauthorized_user",
        date=1234567890
    )
    
    print(f"授权用户检查: {bot.is_authorized(authorized_message)}")
    print(f"未授权用户检查: {bot.is_authorized(unauthorized_message)}")

def main():
    """主演示函数"""
    print("Python Telegram Bot 功能演示")
    print("这个演示展示机器人的核心功能，无需真实的Telegram连接")
    print()
    
    # 加载环境变量（如果有的话）
    load_dotenv()
    
    demos = [
        ("消息分片", demo_message_splitting),
        ("Claude响应提取", demo_claude_response_extraction),
        ("安全检查", demo_security_check)
    ]
    
    for demo_name, demo_func in demos:
        try:
            demo_func()
            print("演示完成")
        except Exception as e:
            print(f"演示出错: {e}")
        print()
    
    print("所有演示完成！")
    print()
    print("下一步:")
    print("1. 配置 .env 文件 (复制 .env.python.example)")
    print("2. 设置 TELEGRAM_BOT_TOKEN 和 CLAUDE_CLI_PATH")
    print("3. 运行: python start_bot.py")

if __name__ == "__main__":
    main()