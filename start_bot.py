#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
启动脚本 - Ultra Simple Architecture
Two-layer design: Platform Adapters + Core Router
"""

import sys
import os

def main():
    """启动新架构的机器人"""
    # 检查.env文件是否存在
    if not os.path.exists('.env'):
        print("[ERROR] 未找到.env文件")
        print("请复制 .env.example 为 .env 并配置您的设置")
        print("示例:")
        print("  cp .env.example .env")
        print("  # 然后编辑 .env 文件设置您的 TELEGRAM_BOT_TOKEN")
        return 1
    
    # 检查config.yml是否存在
    if not os.path.exists('config.yml'):
        print("[ERROR] 未找到config.yml配置文件")
        print("请确保config.yml存在并配置了路由和处理器")
        return 1
    
    # 导入并运行新架构
    try:
        from main import main as new_main
        import asyncio
        
        print("[INFO] 启动 Ultra Simple Architecture...")
        print("[INFO] 使用 .env + config.yml 配置")
        print("[INFO] 开始多平台消息处理...")
        print("[INFO] 按 Ctrl+C 停止机器人")
        print()
        
        asyncio.run(new_main())
        
    except KeyboardInterrupt:
        print("\n[INFO] 机器人已停止")
        return 0
    except Exception as e:
        print(f"[ERROR] 启动失败: {e}")
        print("\n[HINT] 如果您想使用旧版本，可以运行:")
        print("   python legacy/telegram_bot.py")
        return 1

if __name__ == "__main__":
    sys.exit(main())