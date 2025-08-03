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
import random

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
        
        # Proxy configuration
        self.http_proxy = os.getenv('HTTP_PROXY')
        self.proxy_config = None
        self.ssl_verify = True
        
        if self.http_proxy:
            self.proxy_config = {
                'http': self.http_proxy,
                'https': self.http_proxy
            }
            self.ssl_verify = False  # Disable SSL verification when using proxy
            logger.info(f"Discord proxy config: {self.proxy_config}, SSL verify: {self.ssl_verify}")
            logger.info("Proxy detected, disabling SSL verification for Discord")
        
        # Bot information for mention detection
        self.bot_id = None
        self.bot_username = None
        self._get_bot_info()
        
        # Gateway for real-time events (optional)
        self.gateway_url = None
        self.sequence_number = None
        self.session_id = None
        
        # Retry configuration
        self.max_retries = 3
        self.base_delay = 1.0  # Base delay for exponential backoff
        self.max_delay = 30.0  # Maximum delay between retries
        
        # Proxy health monitoring
        self.proxy_healthy = True
        self.proxy_last_check = 0
        self.proxy_check_interval = 300  # Check proxy health every 5 minutes
        self.proxy_consecutive_failures = 0
        self.max_proxy_failures = 5  # Mark proxy as unhealthy after 5 consecutive failures
        
        # Circuit breaker for severe proxy issues
        self.circuit_breaker_open = False
        self.circuit_breaker_open_time = 0
        self.circuit_breaker_timeout = 600  # 10 minutes circuit breaker timeout
        self.severe_failure_threshold = 10  # Open circuit after 10 consecutive failures
        
        logger.info(f"Discord adapter initialized")
        if self.bot_id:
            logger.info(f"Bot ID: {self.bot_id}, username: {self.bot_username}")
        if self.allowed_user_ids:
            logger.info(f"Allowed user IDs: {self.allowed_user_ids}")
        if self.allowed_channel_ids:
            logger.info(f"Allowed channel IDs: {self.allowed_channel_ids}")
        if self.allowed_guild_ids:
            logger.info(f"Allowed guild IDs: {self.allowed_guild_ids}")
    
    def _get_bot_info(self):
        """Get bot information from Discord API"""
        try:
            import asyncio
            import threading
            import requests
            
            # Use synchronous requests instead of async to avoid event loop issues
            url = f"{self.api_base}/users/@me"
            headers = {
                'Authorization': f'Bot {self.bot_token}',
                'Content-Type': 'application/json'
            }
            
            # Prepare proxies for requests library
            proxies = {}
            if self.proxy_config:
                proxies = {
                    'http': self.proxy_config.get('http'),
                    'https': self.proxy_config.get('https')
                }
            
            response = requests.get(url, headers=headers, proxies=proxies, verify=self.ssl_verify, timeout=10)
            
            if response.status_code == 200:
                bot_info = response.json()
                self.bot_id = bot_info.get('id')
                self.bot_username = bot_info.get('username')
                logger.info(f"Discord bot info retrieved: ID={self.bot_id}, username={self.bot_username}")
            else:
                logger.error(f"Discord API error getting bot info: {response.status_code} - {response.text}")
                
        except Exception as e:
            logger.error(f"Error getting Discord bot info: {e}")
    
    async def _check_proxy_health(self) -> bool:
        """Check if proxy is healthy by making a simple request"""
        if not self.proxy_config:
            return True  # No proxy configured, assume healthy
        
        current_time = time.time()
        if current_time - self.proxy_last_check < self.proxy_check_interval:
            return self.proxy_healthy
        
        try:
            # Simple health check - GET Discord API base endpoint
            url = f"{self.api_base}/gateway"
            headers = {'User-Agent': 'DiscordBot (HealthCheck, 1.0)'}
            
            connector = aiohttp.TCPConnector(ssl=self.ssl_verify)
            timeout = aiohttp.ClientTimeout(total=10)  # Shorter timeout for health check
            
            async with aiohttp.ClientSession(connector=connector, timeout=timeout) as session:
                kwargs = {'headers': headers}
                if self.proxy_config:
                    kwargs['proxy'] = self.proxy_config.get('https', self.proxy_config.get('http'))
                
                async with session.get(url, **kwargs) as response:
                    if response.status == 200:
                        self.proxy_healthy = True
                        self.proxy_consecutive_failures = 0
                        logger.debug("Proxy health check passed")
                    else:
                        self._handle_proxy_failure(f"Health check failed: HTTP {response.status}")
        
        except Exception as e:
            self._handle_proxy_failure(f"Health check exception: {e}")
        
        self.proxy_last_check = current_time
        return self.proxy_healthy
    
    def _handle_proxy_failure(self, error_msg: str):
        """Handle proxy failure and update health status"""
        self.proxy_consecutive_failures += 1
        logger.warning(f"Proxy failure #{self.proxy_consecutive_failures}: {error_msg}")
        
        if self.proxy_consecutive_failures >= self.max_proxy_failures:
            self.proxy_healthy = False
            logger.error(f"Proxy marked as unhealthy after {self.proxy_consecutive_failures} consecutive failures")
        
        # Circuit breaker logic for severe failures
        if self.proxy_consecutive_failures >= self.severe_failure_threshold:
            self.circuit_breaker_open = True
            self.circuit_breaker_open_time = time.time()
            logger.error(f"Circuit breaker opened after {self.proxy_consecutive_failures} failures. Blocking requests for {self.circuit_breaker_timeout}s")
        
    def _reset_proxy_health(self):
        """Reset proxy health status after successful request"""
        if not self.proxy_healthy or self.proxy_consecutive_failures > 0:
            logger.info("Proxy health restored")
            self.proxy_healthy = True
            self.proxy_consecutive_failures = 0
            
        # Reset circuit breaker on successful request
        if self.circuit_breaker_open:
            logger.info("Circuit breaker closed - requests restored")
            self.circuit_breaker_open = False
            self.circuit_breaker_open_time = 0
    
    def _is_circuit_breaker_open(self) -> bool:
        """Check if circuit breaker is open"""
        if not self.circuit_breaker_open:
            return False
        
        # Check if timeout has passed
        if time.time() - self.circuit_breaker_open_time >= self.circuit_breaker_timeout:
            logger.info("Circuit breaker timeout expired, attempting to close")
            self.circuit_breaker_open = False
            self.circuit_breaker_open_time = 0
            return False
        
        return True
    
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
                                # Check if message already processed
                                if self.is_message_processed(message.message_id):
                                    logger.debug(f"Discord message {message.message_id} already processed, skipping")
                                    last_message_id = message.message_id
                                    continue
                                
                                # Mark as processed before processing to avoid duplicates
                                self.mark_message_processed(message.message_id)
                                
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
                logger.error(f"Exception type: {type(e)}")
                import traceback
                logger.error(f"Traceback: {traceback.format_exc()}")
                
                # Longer wait on error to avoid spam
                error_wait = min(self.poll_interval * 3, 30)
                logger.info(f"Waiting {error_wait}s before retrying due to error")
                await asyncio.sleep(error_wait)
    
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
    
    async def _make_request_with_retry(self, method: str, url: str, **kwargs) -> Optional[Dict[str, Any]]:
        """Make HTTP request with retry mechanism and exponential backoff"""
        # Check circuit breaker first
        if self._is_circuit_breaker_open():
            logger.warning("Circuit breaker is open, blocking request")
            return None
            
        # Check proxy health before making requests
        if self.proxy_config and not await self._check_proxy_health():
            logger.warning("Proxy is unhealthy, skipping request")
            return None
        
        for attempt in range(self.max_retries + 1):
            try:
                # Create connector with proxy and SSL settings
                connector = aiohttp.TCPConnector(ssl=self.ssl_verify)
                timeout = aiohttp.ClientTimeout(total=60)
                
                async with aiohttp.ClientSession(connector=connector, timeout=timeout) as session:
                    if self.proxy_config:
                        kwargs['proxy'] = self.proxy_config.get('https', self.proxy_config.get('http'))
                    
                    if method.upper() == 'GET':
                        async with session.get(url, **kwargs) as response:
                            # Check if response is successful
                            if response.status == 200:
                                self._reset_proxy_health()  # Reset proxy health on success
                                return {'status': response.status, 'data': await response.json()}
                            elif response.status < 500:  # Client error, don't retry
                                return {'status': response.status, 'error': await response.text()}
                            else:  # Server error, retry
                                raise aiohttp.ClientResponseError(
                                    request_info=response.request_info,
                                    history=response.history,
                                    status=response.status
                                )
                    
                    elif method.upper() == 'POST':
                        async with session.post(url, **kwargs) as response:
                            if response.status in [200, 201]:
                                self._reset_proxy_health()  # Reset proxy health on success
                                return {'status': response.status, 'data': await response.json()}
                            elif response.status < 500:
                                return {'status': response.status, 'error': await response.text()}
                            else:
                                raise aiohttp.ClientResponseError(
                                    request_info=response.request_info,
                                    history=response.history,
                                    status=response.status
                                )
                    
                    elif method.upper() == 'PATCH':
                        async with session.patch(url, **kwargs) as response:
                            if response.status == 200:
                                self._reset_proxy_health()  # Reset proxy health on success
                                return {'status': response.status, 'data': await response.json()}
                            elif response.status < 500:
                                return {'status': response.status, 'error': await response.text()}
                            else:
                                raise aiohttp.ClientResponseError(
                                    request_info=response.request_info,
                                    history=response.history,
                                    status=response.status
                                )
            
            except (asyncio.TimeoutError, aiohttp.ClientError, ConnectionError) as e:
                # Track proxy failure if using proxy
                if self.proxy_config:
                    self._handle_proxy_failure(f"Request failed: {e}")
                
                if attempt == self.max_retries:
                    logger.error(f"Request failed after {self.max_retries + 1} attempts: {e}")
                    raise
                
                # Calculate delay with exponential backoff and jitter
                delay = min(self.base_delay * (2 ** attempt), self.max_delay)
                jitter = random.uniform(0.1, 0.5) * delay
                total_delay = delay + jitter
                
                logger.warning(f"Request attempt {attempt + 1} failed: {e}. Retrying in {total_delay:.2f}s...")
                await asyncio.sleep(total_delay)
            
            except Exception as e:
                # Don't retry for non-network errors
                logger.error(f"Non-retryable error in request: {e}")
                raise
        
        return None
    
    async def get_channel_messages(self, channel_id: str, limit: int = 50, after: Optional[str] = None) -> List[Dict[str, Any]]:
        """Get messages from Discord channel with retry mechanism"""
        try:
            url = f"{self.api_base}/channels/{channel_id}/messages"
            headers = {
                'Authorization': f'Bot {self.bot_token}',
                'Content-Type': 'application/json'
            }
            
            params = {'limit': limit}
            if after:
                params['after'] = after
            
            result = await self._make_request_with_retry('GET', url, headers=headers, params=params)
            if result and result['status'] == 200:
                return result['data']
            elif result:
                logger.error(f"Discord API error: {result['status']} - {result.get('error', 'Unknown error')}")
                return []
            else:
                logger.error("Failed to get response from Discord API")
                return []
                        
        except Exception as e:
            logger.error(f"Failed to get Discord messages: {e}")
            logger.error(f"Exception type: {type(e)}")
            import traceback
            logger.error(f"Traceback: {traceback.format_exc()}")
            return []
    
    def parse_message(self, message_data: Dict[str, Any]) -> Optional[DiscordMessage]:
        """Parse Discord message from API data"""
        try:
            if not message_data.get('content'):
                return None
            
            # Skip bot messages
            if message_data.get('author', {}).get('bot', False):
                return None
            
            # Check if bot is mentioned (only process if mentioned)
            if not self._is_bot_mentioned_in_discord(message_data['content']):
                logger.debug(f"Bot not mentioned, ignoring Discord message")
                return None
            
            # Clean Discord formatting from content (including bot mentions)
            cleaned_content = self._clean_discord_content(message_data['content'])
            
            return DiscordMessage(
                message_id=message_data['id'],
                channel_id=message_data['channel_id'],
                content=cleaned_content,
                author_id=message_data['author']['id'],
                author_username=message_data['author'].get('username', 'unknown'),
                guild_id=message_data.get('guild_id')
            )
        except Exception as e:
            logger.error(f"Failed to parse Discord message: {e}")
            return None
    
    def _is_bot_mentioned_in_discord(self, content: str) -> bool:
        """Check if the bot is mentioned in Discord message"""
        if not self.bot_id:
            return True  # If we can't determine bot ID, process all messages
        
        import re
        
        # Check for direct mention: <@bot_id> or <@!bot_id>
        mention_pattern = f"<@!?{self.bot_id}>"
        if re.search(mention_pattern, content):
            return True
        
        return False
    
    def _clean_discord_content(self, content: str) -> str:
        """Clean Discord-specific formatting from message content"""
        import re
        
        # Remove user mentions: <@123456> or <@!123456>
        content = re.sub(r'<@!?\d+>', '', content)
        
        # Remove role mentions: <@&123456>
        content = re.sub(r'<@&\d+>', '', content)
        
        # Remove channel mentions: <#123456>
        content = re.sub(r'<#\d+>', '', content)
        
        # Remove custom emoji: <:name:123456> or <a:name:123456>
        content = re.sub(r'<a?:[^:]+:\d+>', '', content)
        
        # Clean up extra whitespace
        content = re.sub(r'\s+', ' ', content).strip()
        
        return content
    
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
        """Send plain text message to Discord with retry mechanism"""
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
            
            result = await self._make_request_with_retry('POST', url, headers=headers, json=data)
            if result and result['status'] in [200, 201]:
                message_data = result['data']
                message_id = message_data['id']
                logger.info(f"Message sent successfully to Discord channel {channel_id}, message ID: {message_id}")
                return message_id
            elif result:
                logger.error(f"Discord send message failed: {result['status']} - {result.get('error', 'Unknown error')}")
                return None
            else:
                logger.error("Failed to get response from Discord API")
                return None
                        
        except Exception as e:
            logger.error(f"Error sending Discord message: {e}")
            logger.error(f"Exception type: {type(e)}")
            import traceback
            logger.error(f"Traceback: {traceback.format_exc()}")
            return None
    
    async def edit_message_plain(self, channel_id: str, message_id: str, content: str) -> bool:
        """Edit Discord message with retry mechanism"""
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
            
            result = await self._make_request_with_retry('PATCH', url, headers=headers, json=data)
            if result and result['status'] == 200:
                logger.debug(f"Successfully edited Discord message {message_id}")
                return True
            elif result:
                logger.error(f"Discord edit message failed: {result['status']} - {result.get('error', 'Unknown error')}")
                return False
            else:
                logger.error("Failed to get response from Discord API")
                return False
                        
        except Exception as e:
            logger.error(f"Error editing Discord message: {e}")
            logger.error(f"Exception type: {type(e)}")
            import traceback
            logger.error(f"Traceback: {traceback.format_exc()}")
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
        """Discord supports message editing, but disable if proxy is unhealthy"""
        # Disable streaming if proxy is unhealthy to avoid timeout issues during streaming
        if self.proxy_config and not self.proxy_healthy:
            logger.info("Streaming disabled due to unhealthy proxy")
            return False
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