#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Force cleanup script - Stop all conflicts and reset state
"""

import os
import psutil
import requests
import json
import logging
import time

logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)

def force_kill_python_processes():
    """Force kill all Python processes that might be running bots"""
    killed = []
    
    for proc in psutil.process_iter(['pid', 'name', 'cmdline']):
        try:
            if proc.info['name'].lower() in ['python.exe', 'python3.exe', 'python']:
                cmdline = ' '.join(proc.info['cmdline']) if proc.info['cmdline'] else ''
                
                # Check for bot-related keywords
                if any(keyword in cmdline.lower() for keyword in [
                    'main.py', 'start_bot.py', 'telegram', 'discord', 
                    'claude-code-remote', 'adapters', 'bot'
                ]):
                    if proc.info['pid'] != os.getpid():
                        try:
                            p = psutil.Process(proc.info['pid'])
                            p.kill()  # Force kill
                            killed.append(proc.info['pid'])
                            logger.info(f"Force killed PID {proc.info['pid']}: {cmdline[:100]}")
                        except (psutil.NoSuchProcess, psutil.AccessDenied):
                            pass
        except (psutil.NoSuchProcess, psutil.AccessDenied):
            continue
    
    if killed:
        logger.info(f"Force killed {len(killed)} processes")
        time.sleep(2)  # Wait for processes to die
    else:
        logger.info("No conflicting processes found")

def reset_telegram_state(bot_token):
    """Reset Telegram bot state completely"""
    try:
        # Delete webhook
        url = f"https://api.telegram.org/bot{bot_token}/deleteWebhook"
        proxies = {'http': 'http://127.0.0.1:7893', 'https': 'http://127.0.0.1:7893'}
        
        response = requests.get(url, proxies=proxies, verify=False, timeout=10)
        if response.status_code == 200:
            logger.info("Webhook deleted")
        
        # Get and clear all updates
        updates_url = f"https://api.telegram.org/bot{bot_token}/getUpdates"
        response = requests.get(updates_url, proxies=proxies, verify=False, timeout=10)
        
        if response.status_code == 200:
            data = response.json()
            if data.get('ok'):
                updates = data.get('result', [])
                logger.info(f"Found {len(updates)} pending updates")
                
                if updates:
                    # Clear all by setting offset to last update + 1
                    last_id = updates[-1]['update_id']
                    clear_url = f"{updates_url}?offset={last_id + 1}&timeout=1"
                    requests.get(clear_url, proxies=proxies, verify=False, timeout=10)
                    logger.info(f"Cleared all {len(updates)} pending updates")
    
    except Exception as e:
        logger.error(f"Error resetting Telegram state: {e}")

def clear_processed_messages():
    """Clear processed message files"""
    files = ['processed_messages_telegram.json', 'processed_messages_discord.json']
    
    for file in files:
        if os.path.exists(file):
            try:
                os.remove(file)
                logger.info(f"Deleted {file}")
            except Exception as e:
                logger.error(f"Failed to delete {file}: {e}")

def main():
    logger.info("=== FORCE CLEANUP STARTING ===")
    
    # Step 1: Kill all processes
    logger.info("Step 1: Force killing conflicting processes...")
    force_kill_python_processes()
    
    # Step 2: Reset Telegram state
    bot_token = os.getenv('TELEGRAM_BOT_TOKEN')
    if bot_token:
        logger.info("Step 2: Resetting Telegram state...")
        reset_telegram_state(bot_token)
    else:
        logger.warning("TELEGRAM_BOT_TOKEN not set, skipping Telegram reset")
    
    # Step 3: Clear processed message files
    logger.info("Step 3: Clearing processed message files...")
    clear_processed_messages()
    
    logger.info("=== FORCE CLEANUP COMPLETED ===")
    logger.info("You can now restart your bot safely.")
    logger.info("All previous state has been cleared.")

if __name__ == "__main__":
    main()