#!/usr/bin/env python3
"""
Ultra Simple Architecture Main Entry Point
Two-layer design: Platform Adapters + Core Router
"""

import asyncio
import logging
import os
from typing import Dict, Any
from dotenv import load_dotenv

from core.router import MessageRouter
from adapters.telegram import TelegramAdapter
from adapters.discord import DiscordAdapter

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)


def load_config() -> Dict[str, Any]:
    """Load configuration from environment variables and config file"""
    # Load .env file
    load_dotenv()
    
    config = {
        # Telegram configuration
        'telegram': {
            'bot_token': os.getenv('TELEGRAM_BOT_TOKEN'),
            'allowed_user_ids': [],
            'allowed_chat_ids': [],
            'poll_interval': int(os.getenv('POLL_INTERVAL', '2')),
            'http_proxy': os.getenv('HTTP_PROXY')
        },
        
        # Discord configuration
        'discord': {
            'bot_token': os.getenv('DISCORD_BOT_TOKEN'),
            'allowed_user_ids': [],
            'allowed_channel_ids': [],
            'allowed_guild_ids': [],
            'poll_interval': int(os.getenv('DISCORD_POLL_INTERVAL', '3'))
        },
        
        # Global settings
        'log_level': os.getenv('LOG_LEVEL', 'INFO'),
        'config_file': 'config.yml'
    }
    
    # Parse allowed user IDs
    user_ids_str = os.getenv('ALLOWED_USER_IDS')
    if user_ids_str:
        try:
            config['telegram']['allowed_user_ids'] = [int(x.strip()) for x in user_ids_str.split(',') if x.strip()]
        except ValueError:
            logger.warning("ALLOWED_USER_IDS format error, ignoring user restrictions")
    
    # Parse allowed chat IDs
    chat_ids_str = os.getenv('ALLOWED_CHAT_IDS')
    if chat_ids_str:
        try:
            config['telegram']['allowed_chat_ids'] = [int(x.strip()) for x in chat_ids_str.split(',') if x.strip()]
        except ValueError:
            logger.warning("ALLOWED_CHAT_IDS format error, ignoring chat restrictions")
    
    # Parse Discord allowed user IDs
    discord_user_ids_str = os.getenv('DISCORD_ALLOWED_USER_IDS')
    if discord_user_ids_str:
        try:
            config['discord']['allowed_user_ids'] = [x.strip() for x in discord_user_ids_str.split(',') if x.strip()]
        except ValueError:
            logger.warning("DISCORD_ALLOWED_USER_IDS format error")
    
    # Parse Discord allowed channel IDs
    discord_channel_ids_str = os.getenv('DISCORD_ALLOWED_CHANNEL_IDS')
    if discord_channel_ids_str:
        try:
            config['discord']['allowed_channel_ids'] = [x.strip() for x in discord_channel_ids_str.split(',') if x.strip()]
        except ValueError:
            logger.warning("DISCORD_ALLOWED_CHANNEL_IDS format error")
    
    # Parse Discord allowed guild IDs
    discord_guild_ids_str = os.getenv('DISCORD_ALLOWED_GUILD_IDS')
    if discord_guild_ids_str:
        try:
            config['discord']['allowed_guild_ids'] = [x.strip() for x in discord_guild_ids_str.split(',') if x.strip()]
        except ValueError:
            logger.warning("DISCORD_ALLOWED_GUILD_IDS format error")
    
    # Validate required configuration - at least one platform should be configured
    has_telegram = bool(config['telegram']['bot_token'])
    has_discord = bool(config['discord']['bot_token'])
    
    if not has_telegram and not has_discord:
        logger.warning("No platform tokens configured. Please set TELEGRAM_BOT_TOKEN or DISCORD_BOT_TOKEN")
    
    return config


async def main():
    """Main function - start the ultra simple architecture"""
    try:
        # Load configuration
        config = load_config()
        
        # Set log level
        log_level = getattr(logging, config['log_level'].upper(), logging.INFO)
        logging.getLogger().setLevel(log_level)
        
        logger.info("Ultra Simple Architecture starting...")
        logger.info("Configuration loaded:")
        logger.info(f"  Log level: {config['log_level']}")
        logger.info(f"  Config file: {config['config_file']}")
        
        # Create message router
        router = MessageRouter(config['config_file'])
        
        # Create and register platform adapters
        adapters = []
        
        # Telegram adapter
        if config['telegram']['bot_token']:
            logger.info("Initializing Telegram adapter...")
            if config['telegram']['allowed_user_ids']:
                logger.info(f"  Allowed user IDs: {config['telegram']['allowed_user_ids']}")
            if config['telegram']['allowed_chat_ids']:
                logger.info(f"  Allowed chat IDs: {config['telegram']['allowed_chat_ids']}")
            if config['telegram']['http_proxy']:
                logger.info(f"  HTTP proxy: {config['telegram']['http_proxy']}")
            
            telegram_adapter = TelegramAdapter(router, config['telegram'])
            router.register_adapter("telegram", telegram_adapter)
            adapters.append(telegram_adapter)
        
        # Discord adapter
        if config['discord']['bot_token']:
            logger.info("Initializing Discord adapter...")
            if config['discord']['allowed_user_ids']:
                logger.info(f"  Allowed user IDs: {config['discord']['allowed_user_ids']}")
            if config['discord']['allowed_channel_ids']:
                logger.info(f"  Allowed channel IDs: {config['discord']['allowed_channel_ids']}")
            if config['discord']['allowed_guild_ids']:
                logger.info(f"  Allowed guild IDs: {config['discord']['allowed_guild_ids']}")
            
            discord_adapter = DiscordAdapter(router, config['discord'])
            router.register_adapter("discord", discord_adapter)
            adapters.append(discord_adapter)
        
        # You can add more adapters here:
        # line_adapter = LineAdapter(router, config['line'])
        # router.register_adapter("line", line_adapter)
        # 
        # feishu_adapter = FeishuAdapter(router, config['feishu'])
        # router.register_adapter("feishu", feishu_adapter)
        
        if not adapters:
            logger.error("No adapters configured! Please set up at least one platform.")
            return 1
        
        logger.info(f"All adapters registered ({len(adapters)} platforms), starting message processing...")
        
        # Start all platform listeners
        await asyncio.gather(*[adapter.listen() for adapter in adapters])
        
    except Exception as e:
        logger.error(f"Failed to start application: {e}")
        return 1


if __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        logger.info("Application stopped by user")
    except Exception as e:
        logger.error(f"Application crashed: {e}")
        exit(1)