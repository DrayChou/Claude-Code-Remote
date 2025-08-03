"""
Discord Platform Adapter - Ultra Simple Architecture
Handles Discord message receiving and sending with streaming support
"""

import asyncio
import logging
import os
import time
import json
from typing import Optional, List, Dict, Any
import aiohttp
from dataclasses import dataclass
from adapters.base import PlatformAdapter, StreamingContext

logger = logging.getLogger(__name__)


@dataclass
class DiscordMessage:
    """Discord message data structure"""
    message_id: str
    channel_id: str
    content: str
    author_id: str
    author_username: str
    guild_id: Optional[str] = None


class DiscordAdapter(PlatformAdapter):
    """Discord platform adapter - handles all Discord communication"""
    
    def __init__(self, router, config: Dict[str, Any]):
        """Initialize Discord adapter with configuration"""
        super().__init__(router)
        
        self.bot_token = config['bot_token']
        self.api_base = "https://discord.com/api/v10"
        self.max_message_length = 2000  # Discord message length limit
        self.poll_interval = config.get('poll_interval', 2)
        
        # Authorization settings
        self.allowed_user_ids = config.get('allowed_user_ids', [])
        self.allowed_channel_ids = config.get('allowed_channel_ids', [])
        self.allowed_guild_ids = config.get('allowed_guild_ids', [])
        
        # Gateway for real-time events (optional)
        self.gateway_url = None
        self.sequence_number = None
        self.session_id = None
        
        logger.info(f"Discord adapter initialized")
        if self.allowed_user_ids:
            logger.info(f"Allowed user IDs: {self.allowed_user_ids}")
        if self.allowed_channel_ids:
            logger.info(f"Allowed channel IDs: {self.allowed_channel_ids}")
        if self.allowed_guild_ids:
            logger.info(f"Allowed guild IDs: {self.allowed_guild_ids}")
    
    async def listen(self):
        """Listen for Discord messages - polling method"""
        logger.info("Discord adapter started listening (polling mode)")
        logger.info(f"Poll interval: {self.poll_interval} seconds")
        
        last_message_id = None
        
        while True:
            try:
                # Get recent messages from allowed channels
                for channel_id in self.allowed_channel_ids:
                    messages = await self.get_channel_messages(channel_id, after=last_message_id)
                    
                    if messages:
                        logger.info(f"Received {len(messages)} messages from channel {channel_id}")
                        
                        for message_data in reversed(messages):  # Process in chronological order
                            message = self.parse_message(message_data)
                            if message:
                                await self.process_discord_message(message)
                                last_message_id = message.message_id
                            else:
                                logger.debug("Skipping invalid message")
                
                # Wait for next poll
                await asyncio.sleep(self.poll_interval)
                
            except KeyboardInterrupt:
                logger.info("Received interrupt signal, stopping Discord adapter")
                break
            except Exception as e:
                logger.error(f"Error in Discord listening loop: {e}")
                await asyncio.sleep(self.poll_interval)
    
    async def send_message(self, channel_id: str, content: str):
        """Send message to Discord channel"""
        try:
            # Handle long messages with smart splitting
            if len(content) > self.max_message_length:
                return await self.send_long_message(channel_id, content)
            else:
                message_id = await self.send_message_plain(channel_id, content)
                return message_id is not None
                
        except Exception as e:
            logger.error(f"Error sending message to Discord channel {channel_id}: {e}")
            return False
    
    async def get_channel_messages(self, channel_id: str, limit: int = 50, after: Optional[str] = None) -> List[Dict[str, Any]]:
        """Get messages from Discord channel"""
        try:
            url = f"{self.api_base}/channels/{channel_id}/messages"
            headers = {
                'Authorization': f'Bot {self.bot_token}',
                'Content-Type': 'application/json'
            }
            
            params = {'limit': limit}
            if after:
                params['after'] = after
            
            async with aiohttp.ClientSession() as session:
                async with session.get(url, headers=headers, params=params) as response:
                    if response.status == 200:
                        messages = await response.json()
                        return messages
                    else:
                        logger.error(f"Discord API error: {response.status} - {await response.text()}")
                        return []
                        
        except Exception as e:
            logger.error(f"Failed to get Discord messages: {e}")
            return []
    
    def parse_message(self, message_data: Dict[str, Any]) -> Optional[DiscordMessage]:
        """Parse Discord message from API data"""
        try:
            if not message_data.get('content'):
                return None
            
            # Skip bot messages
            if message_data.get('author', {}).get('bot', False):
                return None
            
            return DiscordMessage(
                message_id=message_data['id'],
                channel_id=message_data['channel_id'],
                content=message_data['content'],
                author_id=message_data['author']['id'],
                author_username=message_data['author'].get('username', 'unknown'),
                guild_id=message_data.get('guild_id')
            )
        except Exception as e:
            logger.error(f"Failed to parse Discord message: {e}")
            return None
    
    async def process_discord_message(self, message: DiscordMessage):
        """Process individual Discord message"""
        try:
            logger.info(f"Processing message from @{message.author_username} (ID:{message.author_id}): {message.content[:50]}...")
            
            # Check authorization
            if not self.is_authorized(message):
                logger.warning(f"User @{message.author_username} (ID:{message.author_id}) not authorized, ignoring message")
                return  # Silent ignore
            
            # Process through router
            await self.on_message("discord", message.author_id, message.channel_id, message.content)
                
        except Exception as e:
            logger.error(f"Error processing Discord message: {e}")
    
    def is_authorized(self, message: DiscordMessage) -> bool:
        """Check if user is authorized"""
        # If no restrictions set, allow all users
        if not self.allowed_user_ids and not self.allowed_channel_ids and not self.allowed_guild_ids:
            return True
        
        # Check user ID
        if self.allowed_user_ids and message.author_id in self.allowed_user_ids:
            return True
        
        # Check channel ID
        if self.allowed_channel_ids and message.channel_id in self.allowed_channel_ids:
            return True
        
        # Check guild ID
        if self.allowed_guild_ids and message.guild_id and message.guild_id in self.allowed_guild_ids:
            return True
        
        return False
    
    async def send_message_plain(self, channel_id: str, content: str) -> Optional[str]:
        """Send plain text message to Discord"""
        try:
            logger.info(f"Sending message to Discord channel {channel_id}: {content[:100]}...")
            
            url = f"{self.api_base}/channels/{channel_id}/messages"
            headers = {
                'Authorization': f'Bot {self.bot_token}',
                'Content-Type': 'application/json'
            }
            data = {
                'content': content
            }
            
            async with aiohttp.ClientSession() as session:
                async with session.post(url, headers=headers, json=data) as response:
                    if response.status in [200, 201]:
                        result = await response.json()
                        message_id = result['id']
                        logger.info(f"Message sent successfully to Discord channel {channel_id}, message ID: {message_id}")
                        return message_id
                    else:
                        logger.error(f"Discord send message failed: {response.status} - {await response.text()}")
                        return None
                        
        except Exception as e:
            logger.error(f"Error sending Discord message: {e}")
            return None
    
    async def edit_message_plain(self, channel_id: str, message_id: str, content: str) -> bool:
        """Edit Discord message"""
        try:
            if len(content) > self.max_message_length:
                content = content[:self.max_message_length - 3] + "..."
            
            url = f"{self.api_base}/channels/{channel_id}/messages/{message_id}"
            headers = {
                'Authorization': f'Bot {self.bot_token}',
                'Content-Type': 'application/json'
            }
            data = {
                'content': content
            }
            
            async with aiohttp.ClientSession() as session:
                async with session.patch(url, headers=headers, json=data) as response:
                    if response.status == 200:
                        logger.debug(f"Successfully edited Discord message {message_id}")
                        return True
                    else:
                        logger.error(f"Discord edit message failed: {response.status} - {await response.text()}")
                        return False
                        
        except Exception as e:
            logger.error(f"Error editing Discord message: {e}")
            return False
    
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
    
    async def send_long_message(self, channel_id: str, content: str) -> bool:
        """Send long message with automatic splitting"""
        try:
            parts = self.split_message(content)
            
            if len(parts) == 1:
                # Single message
                message_id = await self.send_message_plain(channel_id, content)
                return message_id is not None
            
            # Multi-part message sending
            success_count = 0
            for i, part in enumerate(parts, 1):
                # Add part information
                if len(parts) > 1:
                    header = f"**[{i}/{len(parts)}]**\n\n"
                    message_text = header + part
                else:
                    message_text = part
                
                sent_id = await self.send_message_plain(channel_id, message_text)
                if sent_id:
                    success_count += 1
                    
                    # Short delay between messages to avoid rate limiting
                    if i < len(parts):
                        await asyncio.sleep(1)  # Discord rate limits are stricter
                else:
                    logger.error(f"Failed to send part {i} of message")
            
            logger.info(f"Long message parts sent: {success_count}/{len(parts)} successful")
            return success_count == len(parts)
            
        except Exception as e:
            logger.error(f"Error sending long message: {e}")
            return False
    
    # Streaming mode support
    async def supports_streaming(self) -> bool:
        """Discord supports message editing, so streaming is supported"""
        return True
    
    async def start_streaming_response(self, channel_id: str, initial_message: str = "🤔 Thinking...") -> Optional[StreamingContext]:
        """Start streaming response for Discord"""
        try:
            message_id = await self.send_message_plain(channel_id, initial_message)
            if message_id:
                return StreamingContext(
                    chat_id=channel_id,
                    message_id=str(message_id),
                    platform="discord",
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
        """Update streaming response for Discord"""
        try:
            # Check if update should happen based on timing and content
            if not context.should_update(content):
                return True  # Not an error, just not time to update yet
            
            # Edit the message
            success = await self.edit_message_plain(context.chat_id, context.message_id, content)
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