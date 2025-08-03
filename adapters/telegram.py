"""
Telegram Platform Adapter - Ultra Simple Architecture
Handles Telegram message receiving and sending in the new 2-layer system
"""

import asyncio
import logging
import os
import time
import re
import json
from typing import Optional, List, Dict, Any
import requests
from dataclasses import dataclass
from adapters.base import PlatformAdapter, StreamingContext

# 禁用SSL警告
import urllib3
urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)

logger = logging.getLogger(__name__)


@dataclass
class TelegramMessage:
    """Telegram message data structure"""
    message_id: int
    chat_id: int
    text: str
    from_user_id: int
    from_username: str
    date: int


class TelegramAdapter(PlatformAdapter):
    """Telegram platform adapter - handles all Telegram communication"""
    
    def __init__(self, router, config: Dict[str, Any]):
        """Initialize Telegram adapter with configuration"""
        super().__init__(router)
        
        self.bot_token = config['bot_token']
        self.api_base = f"https://api.telegram.org/bot{self.bot_token}"
        self.last_update_id = 0
        self.max_message_length = 4096
        self.poll_interval = config.get('poll_interval', 2)
        
        # Authorization settings
        self.allowed_user_ids = config.get('allowed_user_ids', [])
        self.allowed_chat_ids = config.get('allowed_chat_ids', [])
        
        # Proxy configuration
        self.proxies = {}
        if config.get('http_proxy'):
            self.proxies = {
                'http': config['http_proxy'],
                'https': config['http_proxy']
            }
            logger.info(f"Using HTTP proxy: {config['http_proxy']}")
        
        logger.info(f"Telegram adapter initialized")
        if self.allowed_user_ids:
            logger.info(f"Allowed user IDs: {self.allowed_user_ids}")
        if self.allowed_chat_ids:
            logger.info(f"Allowed chat IDs: {self.allowed_chat_ids}")
    
    async def listen(self):
        """Listen for Telegram messages - main polling loop"""
        logger.info("Telegram adapter started listening")
        logger.info(f"Polling interval: {self.poll_interval} seconds")
        
        while True:
            try:
                # Get updates from Telegram
                updates = self.get_updates()
                
                if updates:
                    logger.info(f"Received {len(updates)} updates")
                    
                    for update in updates:
                        message = self.parse_message(update)
                        if message:
                            # Process message through router
                            await self.process_telegram_message(message)
                        else:
                            logger.debug("Skipping non-text or invalid update")
                
                # Wait for next poll
                await asyncio.sleep(self.poll_interval)
                
            except KeyboardInterrupt:
                logger.info("Received interrupt signal, stopping Telegram adapter")
                break
            except Exception as e:
                logger.error(f"Error in Telegram listening loop: {e}")
                await asyncio.sleep(self.poll_interval)
    
    async def send_message(self, chat_id: str, content: str):
        """Send message to Telegram chat"""
        try:
            chat_id_int = int(chat_id)
            
            # Handle long messages with smart splitting
            if len(content) > self.max_message_length:
                return await self.send_long_message(chat_id_int, content)
            else:
                message_id = self.send_message_plain(chat_id_int, content)
                return message_id is not None
                
        except Exception as e:
            logger.error(f"Error sending message to Telegram chat {chat_id}: {e}")
            return False
    
    def get_updates(self, timeout: int = 30) -> List[Dict[str, Any]]:
        """Get updates from Telegram API"""
        try:
            url = f"{self.api_base}/getUpdates"
            params = {
                'offset': self.last_update_id + 1,
                'timeout': timeout,
                'limit': 100
            }
            
            # 使用代理时禁用SSL验证
            ssl_verify = not bool(self.proxies)
            logger.info(f"Proxy config: {self.proxies}, SSL verify: {ssl_verify}")
            if not ssl_verify:
                logger.info("Proxy detected, disabling SSL verification")
            
            response = requests.get(
                url, 
                params=params, 
                timeout=timeout + 5,
                proxies=self.proxies,
                verify=ssl_verify
            )
            response.raise_for_status()
            
            data = response.json()
            if data.get('ok'):
                updates = data.get('result', [])
                if updates:
                    self.last_update_id = updates[-1]['update_id']
                return updates
            else:
                logger.error(f"Telegram API error: {data}")
                return []
                
        except requests.RequestException as e:
            logger.error(f"Failed to get Telegram updates: {e}")
            return []
        except Exception as e:
            logger.error(f"Error processing Telegram updates: {e}")
            return []
    
    def parse_message(self, update: Dict[str, Any]) -> Optional[TelegramMessage]:
        """Parse Telegram message from update"""
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
            logger.error(f"Failed to parse message: {e}")
            return None
    
    async def process_telegram_message(self, message: TelegramMessage):
        """Process individual Telegram message"""
        try:
            logger.info(f"Processing message from @{message.from_username} (ID:{message.from_user_id}): {message.text[:50]}...")
            
            # Check authorization for non-builtin commands
            command = message.text.lower().strip()
            builtin_commands = ['/id', 'id', '#id', '/help', 'help', '#help', '/ping', 'ping', '#ping', '/status', 'status', '#status']
            
            if command not in builtin_commands and not self.is_authorized(message):
                logger.warning(f"User @{message.from_username} (ID:{message.from_user_id}) not authorized, ignoring message")
                return  # Silent ignore
            
            # Process through router (router will handle builtin commands)
            await self.on_message("telegram", str(message.from_user_id), str(message.chat_id), message.text)
                
        except Exception as e:
            logger.error(f"Error processing Telegram message: {e}")
    
    def _get_username(self, user_id: str) -> Optional[str]:
        """Get username for user ID (used by router for builtin commands)"""
        # This is a simple implementation - in a real scenario you might want to cache user info
        return None  # For now, let router handle username display
    
    def is_authorized(self, message: TelegramMessage) -> bool:
        """Check if user is authorized"""
        # If no restrictions set, allow all users
        if not self.allowed_user_ids and not self.allowed_chat_ids:
            return True
        
        # Check user ID
        if self.allowed_user_ids and message.from_user_id in self.allowed_user_ids:
            return True
        
        # Check chat ID
        if self.allowed_chat_ids and message.chat_id in self.allowed_chat_ids:
            return True
        
        return False
    
    def send_message_plain(self, chat_id: int, text: str, reply_to_message_id: Optional[int] = None) -> Optional[int]:
        """Send plain text message to Telegram"""
        try:
            logger.info(f"Sending plain text message content: {repr(text[:100])}...")
            
            url = f"{self.api_base}/sendMessage"
            data = {
                'chat_id': chat_id,
                'text': text
            }
            
            if reply_to_message_id:
                data['reply_to_message_id'] = reply_to_message_id
            
            # 使用代理时禁用SSL验证
            ssl_verify = not bool(self.proxies)
            logger.info(f"Send message - Proxy config: {self.proxies}, SSL verify: {ssl_verify}")
            if not ssl_verify:
                logger.info("Proxy detected, disabling SSL verification for message sending")
            
            response = requests.post(
                url, 
                json=data, 
                timeout=30, 
                proxies=self.proxies, 
                verify=ssl_verify
            )
            response.raise_for_status()
            
            result = response.json()
            if result.get('ok'):
                message_id = result['result']['message_id']
                logger.info(f"Plain text message sent successfully to chat {chat_id}, message ID: {message_id}")
                return message_id
            else:
                logger.error(f"Telegram send plain text message failed: {result}")
                return None
                
        except Exception as e:
            logger.error(f"Error sending plain text message: {e}")
            return None
    
    def split_message(self, text: str) -> List[str]:
        """Smart message splitting for long messages"""
        if len(text) <= self.max_message_length:
            return [text]
        
        parts = []
        remaining = text
        
        # Split priority patterns
        split_patterns = [
            '\n\n',  # Double newline (paragraphs)
            '\n',    # Single newline
            '. ',    # Period
            ', ',    # Comma
            ' '      # Space
        ]
        
        while remaining:
            if len(remaining) <= self.max_message_length:
                parts.append(remaining)
                break
            
            # Find best split point
            best_split = self.max_message_length
            
            for pattern in split_patterns:
                # Find last occurrence of pattern within limit
                chunk = remaining[:self.max_message_length]
                last_index = chunk.rfind(pattern)
                
                if last_index > self.max_message_length // 2:  # Ensure split point not too early
                    best_split = last_index + len(pattern)
                    break
            
            # Split message
            part = remaining[:best_split].rstrip()
            parts.append(part)
            remaining = remaining[best_split:].lstrip()
        
        return parts
    
    async def send_long_message(self, chat_id: int, text: str, reply_to_message_id: Optional[int] = None) -> bool:
        """Send long message with automatic splitting"""
        try:
            parts = self.split_message(text)
            
            if len(parts) == 1:
                # Single message
                message_id = self.send_message_plain(chat_id, text, reply_to_message_id)
                return message_id is not None
            
            # Multi-part message sending
            success_count = 0
            for i, part in enumerate(parts, 1):
                # Add part information
                if len(parts) > 1:
                    header = f"[{i}/{len(parts)}]\n\n"
                    message_text = header + part
                else:
                    message_text = part
                
                # Only reply to original message in first part
                reply_id = reply_to_message_id if i == 1 else None
                
                sent_id = self.send_message_plain(chat_id, message_text, reply_id)
                if sent_id:
                    success_count += 1
                    
                    # Short delay between messages to avoid rate limiting
                    if i < len(parts):
                        time.sleep(0.5)
                else:
                    logger.error(f"Failed to send part {i} of message")
            
            logger.info(f"Long message parts sent: {success_count}/{len(parts)} successful")
            return success_count == len(parts)
            
        except Exception as e:
            logger.error(f"Error sending long message: {e}")
            return False
    
    # Streaming mode support
    async def supports_streaming(self) -> bool:
        """Telegram supports message editing, so streaming is supported"""
        return True
    
    async def start_streaming_response(self, chat_id: str, initial_message: str = "🤔 正在思考...") -> Optional[StreamingContext]:
        """Start streaming response for Telegram"""
        try:
            message_id = self.send_message_plain(int(chat_id), initial_message)
            if message_id:
                return StreamingContext(
                    chat_id=chat_id,
                    message_id=str(message_id),
                    platform="telegram",
                    last_content=initial_message,
                    last_update_time=time.time()
                )
            else:
                logger.error("Failed to send initial streaming message")
                return None
        except Exception as e:
            logger.error(f"Failed to start streaming response: {e}")
            return None
    
    async def update_streaming_response(self, context: StreamingContext, content: str) -> bool:
        """Update streaming response for Telegram"""
        try:
            # Check if update should happen based on timing and content
            if not context.should_update(content):
                return True  # Not an error, just not time to update yet
            
            # Limit content length for Telegram
            if len(content) > self.max_message_length:
                content = content[:self.max_message_length - 3] + "..."
            
            # Edit the message
            success = self.edit_message_plain(int(context.chat_id), int(context.message_id), content)
            if success:
                context.last_content = content
                context.last_update_time = time.time()
                logger.debug(f"Successfully updated streaming message, length: {len(content)}")
                return True
            else:
                logger.warning("Failed to update streaming message")
                return False
                
        except Exception as e:
            logger.error(f"Error updating streaming response: {e}")
            return False
    
    async def finalize_streaming_response(self, context: StreamingContext, final_content: str) -> bool:
        """Finalize streaming response with final content"""
        try:
            # Ensure final content is different from last update
            if final_content != context.last_content:
                return await self.update_streaming_response(context, final_content)
            else:
                logger.info("Final content same as last update, no need to edit")
                return True
        except Exception as e:
            logger.error(f"Error finalizing streaming response: {e}")
            return False