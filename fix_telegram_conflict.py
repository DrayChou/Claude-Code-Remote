#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Fix Telegram 409 conflict errors
"""

import os
import psutil
import time
import requests
import json
import logging

# Setup logging
logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)

def find_telegram_processes():
    """Find running Telegram bot processes"""
    telegram_processes = []
    
    for proc in psutil.process_iter(['pid', 'name', 'cmdline']):
        try:
            cmdline = ' '.join(proc.info['cmdline']) if proc.info['cmdline'] else ''
            
            if any(keyword in cmdline.lower() for keyword in [
                'telegram', 'bot', 'main.py', 'start_bot.py', 
                'claude-code-remote', 'adapters'
            ]):
                if proc.info['pid'] != os.getpid():
                    telegram_processes.append({
                        'pid': proc.info['pid'],
                        'name': proc.info['name'],
                        'cmdline': cmdline
                    })
        except (psutil.NoSuchProcess, psutil.AccessDenied):
            continue
    
    return telegram_processes

def stop_telegram_webhook(bot_token):
    """Stop Telegram webhook if any"""
    try:
        url = f"https://api.telegram.org/bot{bot_token}/deleteWebhook"
        
        proxy_configs = [
            {},
            {'http': 'http://127.0.0.1:7893', 'https': 'http://127.0.0.1:7893'},
        ]
        
        for proxy_config in proxy_configs:
            try:
                response = requests.get(url, proxies=proxy_config, verify=False, timeout=10)
                if response.status_code == 200:
                    result = response.json()
                    if result.get('ok'):
                        logger.info("Telegram webhook deleted successfully")
                        return True
                    else:
                        logger.warning(f"Webhook deletion failed: {result}")
                        return False
                break
            except Exception as e:
                logger.debug(f"Failed with proxy {proxy_config}: {e}")
                continue
        
        logger.error("Failed to delete webhook with all proxy configurations")
        return False
                
    except Exception as e:
        logger.error(f"Error deleting webhook: {e}")
        return False

def clear_telegram_updates(bot_token):
    """Clear pending Telegram updates"""
    try:
        url = f"https://api.telegram.org/bot{bot_token}/getUpdates"
        
        proxy_configs = [
            {},
            {'http': 'http://127.0.0.1:7893', 'https': 'http://127.0.0.1:7893'},
        ]
        
        for proxy_config in proxy_configs:
            try:
                response = requests.get(url, proxies=proxy_config, verify=False, timeout=10)
                if response.status_code == 200:
                    result = response.json()
                    if result.get('ok'):
                        updates = result.get('result', [])
                        logger.info(f"Found {len(updates)} pending updates")
                        
                        if updates:
                            last_update_id = updates[-1]['update_id']
                            clear_url = f"{url}?offset={last_update_id + 1}&timeout=1"
                            clear_response = requests.get(clear_url, proxies=proxy_config, verify=False, timeout=10)
                            
                            if clear_response.status_code == 200:
                                logger.info(f"Cleared {len(updates)} pending updates")
                                return True
                        else:
                            logger.info("No pending updates to clear")
                            return True
                break
            except Exception as e:
                logger.debug(f"Failed with proxy {proxy_config}: {e}")
                continue
        
        logger.error("Failed to clear updates")
        return False
        
    except Exception as e:
        logger.error(f"Error clearing updates: {e}")
        return False

def main():
    """Main function"""
    logger.info("Starting Telegram conflict resolution...")
    
    # Find running processes
    logger.info("Checking for running Telegram bot processes...")
    processes = find_telegram_processes()
    
    if processes:
        logger.warning(f"Found {len(processes)} conflicting processes:")
        for proc in processes:
            logger.warning(f"  PID {proc['pid']}: {proc['name']} - {proc['cmdline'][:100]}...")
        
        response = input("Terminate these processes? (y/N): ")
        if response.lower() == 'y':
            for proc in processes:
                try:
                    p = psutil.Process(proc['pid'])
                    p.terminate()
                    logger.info(f"Terminated process PID {proc['pid']}")
                    time.sleep(1)
                    
                    if p.is_running():
                        p.kill()
                        logger.info(f"Force killed process PID {proc['pid']}")
                except (psutil.NoSuchProcess, psutil.AccessDenied) as e:
                    logger.warning(f"Could not terminate PID {proc['pid']}: {e}")
    else:
        logger.info("No conflicting processes found")
    
    # Get bot token
    bot_token = os.getenv('TELEGRAM_BOT_TOKEN')
    if not bot_token:
        logger.error("TELEGRAM_BOT_TOKEN not set")
        return
    
    # Stop webhook
    logger.info("Stopping Telegram webhook...")
    stop_telegram_webhook(bot_token)
    
    # Clear updates
    logger.info("Clearing pending updates...")
    clear_telegram_updates(bot_token)
    
    logger.info("Resolution completed! You can restart your bot safely.")

if __name__ == "__main__":
    main()