#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
简化的启动脚本 - 直接使用.env文件
"""

import sys
import os

def main():
    """启动机器人"""
    # 检查.env文件是否存在
    if not os.path.exists('.env'):
        print("❌ 未找到.env文件")
        print("请复制 .env.example 为 .env 并配置您的设置")
        print("示例:")
        print("  cp .env.example .env")
        print("  # 然后编辑 .env 文件设置您的 TELEGRAM_BOT_TOKEN 和 CLAUDE_CLI_PATH")
        return 1
    
    # 导入并运行机器人
    try:
        from telegram_bot import main as bot_main
        import asyncio
        
        print("🚀 启动 Python Telegram 机器人...")
        print("📁 使用 .env 配置文件")
        print("🔄 开始轮询 Telegram 更新...")
        print("⚠️  按 Ctrl+C 停止机器人")
        print()
        
        asyncio.run(bot_main())
        
    except KeyboardInterrupt:
        print("\n👋 机器人已停止")
        return 0
    except Exception as e:
        print(f"❌ 启动失败: {e}")
        return 1

if __name__ == "__main__":
    sys.exit(main())