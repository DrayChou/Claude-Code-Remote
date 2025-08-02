#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
测试Python Telegram机器人
"""

import asyncio
import json
import os
import time
from unittest.mock import Mock, patch
from telegram_bot import TelegramBot, TelegramMessage, ClaudeResponse

def test_message_splitting():
    """测试消息分片功能"""
    print("测试消息分片功能...")
    
    bot = TelegramBot("test_token", "test_path")
    
    # 测试短消息
    short_text = "这是一条短消息"
    parts = bot.split_message(short_text)
    assert len(parts) == 1, f"短消息应该不被分割，但得到 {len(parts)} 部分"
    print("短消息测试通过")
    
    # 测试长消息
    long_text = "这是一条很长的消息。" * 500  # 创建超长消息
    parts = bot.split_message(long_text)
    print(f"   长消息被分割为 {len(parts)} 部分")
    
    # 验证每部分都在限制内
    for i, part in enumerate(parts):
        if len(part) > bot.max_message_length:
            print(f"第 {i+1} 部分超过长度限制: {len(part)} > {bot.max_message_length}")
            return False
    
    print("长消息分片测试通过")
    return True

def test_claude_response_extraction():
    """测试Claude响应提取"""
    print("测试Claude响应提取...")
    
    bot = TelegramBot("test_token", "test_path")
    
    # 测试JSON格式输出
    json_output = '''
{"type":"system","subtype":"init","message":"Initializing..."}
{"type":"assistant","message":{"content":[{"type":"text","text":"Hello, this is Claude's response!"}]}}
{"type":"result","subtype":"success","result":"Command completed"}
'''
    
    response = bot._extract_claude_response(json_output)
    expected = "Hello, this is Claude's response!"
    
    if response == expected:
        print("JSON格式响应提取测试通过")
    else:
        print(f"JSON格式响应提取失败")
        print(f"   期望: {expected}")
        print(f"   实际: {response}")
        return False
    
    # 测试纯文本输出
    text_output = '''
Windows PowerShell
版权所有 (C) Microsoft Corporation
执行完成
这是Claude的文本回复
'''
    
    response = bot._extract_claude_response(text_output)
    expected = "这是Claude的文本回复"
    
    if response == expected:
        print("纯文本响应提取测试通过")
    else:
        print(f"纯文本响应提取失败")
        print(f"   期望: {expected}")
        print(f"   实际: {response}")
        return False
    
    return True

def test_telegram_message_parsing():
    """测试Telegram消息解析"""
    print("测试Telegram消息解析...")
    
    bot = TelegramBot("test_token", "test_path")
    
    # 模拟Telegram更新数据
    update = {
        "update_id": 123456,
        "message": {
            "message_id": 789,
            "from": {
                "id": 123456789,
                "is_bot": False,
                "first_name": "Test",
                "username": "testuser"
            },
            "chat": {
                "id": 123456789,
                "first_name": "Test",
                "username": "testuser",
                "type": "private"
            },
            "date": int(time.time()),
            "text": "测试消息"
        }
    }
    
    message = bot.parse_message(update)
    
    if message and message.text == "测试消息":
        print("Telegram消息解析测试通过")
        return True
    else:
        print("Telegram消息解析失败")
        return False

def mock_claude_call():
    """模拟Claude调用测试"""
    print("测试Claude调用模拟...")
    
    bot = TelegramBot("test_token", "test_path")
    
    # 模拟成功的响应
    with patch('subprocess.run') as mock_run:
        mock_run.return_value = Mock(
            returncode=0,
            stdout='{"type":"assistant","message":{"content":[{"type":"text","text":"模拟Claude回复"}]}}',
            stderr=''
        )
        
        response = bot.call_claude("测试命令")
        
        if response.success and "模拟Claude回复" in response.response:
            print("Claude调用模拟测试通过")
            return True
        else:
            print("Claude调用模拟失败")
            return False

async def test_telegram_api():
    """测试Telegram API (如果配置了token)"""
    print("测试Telegram API连接...")
    
    token = os.getenv('TELEGRAM_BOT_TOKEN')
    if not token or token == "your_bot_token_here":
        print("跳过Telegram API测试 (未配置token)")
        return True
    
    bot = TelegramBot(token, "test_path")
    
    try:
        # 测试获取bot信息
        import requests
        response = requests.get(f"https://api.telegram.org/bot{token}/getMe", timeout=10)
        
        if response.status_code == 200:
            data = response.json()
            if data.get('ok'):
                bot_info = data.get('result', {})
                print(f"Telegram API连接成功")
                print(f"   Bot名称: {bot_info.get('first_name')}")
                print(f"   Bot用户名: @{bot_info.get('username')}")
                return True
        
        print("Telegram API连接失败")
        return False
        
    except Exception as e:
        print(f"Telegram API测试出错: {e}")
        return False

async def run_all_tests():
    """运行所有测试"""
    print("开始运行Python Telegram机器人测试\n")
    
    tests = [
        ("消息分片", test_message_splitting),
        ("Claude响应提取", test_claude_response_extraction),
        ("Telegram消息解析", test_telegram_message_parsing),
        ("Claude调用模拟", mock_claude_call),
        ("Telegram API", test_telegram_api)
    ]
    
    results = []
    
    for test_name, test_func in tests:
        print(f"运行测试: {test_name}")
        try:
            if asyncio.iscoroutinefunction(test_func):
                result = await test_func()
            else:
                result = test_func()
            results.append(result)
        except Exception as e:
            print(f"测试 {test_name} 出错: {e}")
            results.append(False)
        print()
    
    # 统计结果
    passed = sum(results)
    total = len(results)
    
    print("=" * 50)
    print(f"测试完成: {passed}/{total} 通过")
    
    if passed == total:
        print("所有测试通过！Python机器人应该可以正常工作")
    else:
        print("部分测试失败，请检查实现")
    
    return passed == total

if __name__ == "__main__":
    # 加载环境变量
    from dotenv import load_dotenv
    load_dotenv()
    
    # 运行测试
    asyncio.run(run_all_tests())