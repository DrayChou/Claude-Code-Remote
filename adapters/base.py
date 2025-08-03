"""
Platform Adapter Base Class - Ultra Simple Architecture
Two-layer design: Platform Adapters + Core Router
"""

from abc import ABC, abstractmethod
from typing import Dict, Any, Optional, Set
from dataclasses import dataclass
import time
import json
import os


@dataclass
class Response:
    """Response object containing content and targets"""
    content: str
    targets: list[str]  # Format: ["platform:chat_id", ...]


@dataclass
class StreamingContext:
    """Streaming response context for platforms that support message editing"""
    chat_id: str
    message_id: str
    platform: str
    last_content: str = ""
    last_update_time: float = 0
    update_interval: float = 3.0  # Default 3 seconds between updates
    
    def should_update(self, new_content: str) -> bool:
        """Check if message should be updated based on time and content"""
        current_time = time.time()
        return (current_time - self.last_update_time >= self.update_interval and 
                new_content != self.last_content and
                len(new_content.strip()) > 10)  # Ensure sufficient content


class PlatformAdapter(ABC):
    """Base class for all platform adapters - implements input/output for each platform"""
    
    def __init__(self, router):
        """Initialize adapter with router reference"""
        self.router = router
        self.platform_name = self.__class__.__name__.lower().replace('adapter', '')
        self.processed_messages_file = os.path.abspath(f"processed_messages_{self.platform_name}.json")
        self.processed_messages: Set[str] = set()
        print(f"[{self.platform_name}] Message state file: {self.processed_messages_file}")
        self._load_processed_messages()
    
    @abstractmethod
    async def listen(self):
        """Listen for messages from this platform - implement in subclass"""
        pass
    
    @abstractmethod
    async def send_message(self, chat_id: str, content: str):
        """Send message to specific chat on this platform - implement in subclass"""
        pass
    
    # Streaming mode support (optional implementation)
    async def supports_streaming(self) -> bool:
        """Check if platform supports streaming mode (message editing)"""
        return False
    
    async def start_streaming_response(self, chat_id: str, initial_message: str = "🤔 正在思考...") -> Optional[StreamingContext]:
        """Start streaming response - return context if successful"""
        return None
    
    async def update_streaming_response(self, context: StreamingContext, content: str) -> bool:
        """Update streaming response - return True if successful"""
        return False
    
    async def finalize_streaming_response(self, context: StreamingContext, final_content: str) -> bool:
        """Finalize streaming response with final content"""
        return await self.update_streaming_response(context, final_content)
    
    def _load_processed_messages(self):
        """Load processed message IDs from JSON file"""
        try:
            if os.path.exists(self.processed_messages_file):
                with open(self.processed_messages_file, 'r', encoding='utf-8') as f:
                    data = json.load(f)
                    self.processed_messages = set(data.get('processed_messages', []))
                    print(f"Loaded {len(self.processed_messages)} processed message IDs for {self.platform_name}")
        except Exception as e:
            print(f"Error loading processed messages for {self.platform_name}: {e}")
            self.processed_messages = set()
    
    def _save_processed_messages(self):
        """Save processed message IDs to JSON file"""
        try:
            # Keep only recent messages (last 1000) to prevent file from growing too large
            if len(self.processed_messages) > 1000:
                self.processed_messages = set(list(self.processed_messages)[-1000:])
            
            data = {
                'platform': self.platform_name,
                'last_updated': time.time(),
                'processed_messages': list(self.processed_messages)
            }
            
            with open(self.processed_messages_file, 'w', encoding='utf-8') as f:
                json.dump(data, f, indent=2)
                
        except Exception as e:
            print(f"Error saving processed messages for {self.platform_name}: {e}")
    
    def is_message_processed(self, message_id: str) -> bool:
        """Check if message has already been processed"""
        return message_id in self.processed_messages
    
    def mark_message_processed(self, message_id: str):
        """Mark message as processed"""
        self.processed_messages.add(message_id)
        # Save immediately to prevent loss
        self._save_processed_messages()
    
    async def on_message(self, platform: str, user_id: str, chat_id: str, content: str):
        """Universal message handler - called when message is received"""
        try:
            response = None
            
            # Check if streaming is supported and network is healthy
            force_degraded_mode = getattr(self, 'force_degraded_mode', False)
            
            if await self.supports_streaming() and not force_degraded_mode:
                try:
                    # Try streaming mode processing
                    if hasattr(self.router, 'process_with_streaming'):
                        response = await self.router.process_with_streaming(platform, user_id, chat_id, content, self)
                        if response:
                            print(f"Streaming mode succeeded, sending to {len(response.targets)} targets")
                            # Send the same final response to all other targets
                            for target in response.targets:
                                if target != f"{platform}:{chat_id}":  # Skip origin target (already handled by streaming)
                                    print(f"Sending final response to target: {target}")
                                    await self.send_to_target(target, response.content)
                            return  # Successfully processed with streaming
                except Exception as e:
                    print(f"Streaming mode failed, falling back to normal mode: {e}")
                    # Enable degraded mode temporarily after streaming failure
                    self.force_degraded_mode = True
                    # Schedule re-enabling streaming after some time
                    import asyncio
                    asyncio.create_task(self._re_enable_streaming())
            
            # Fall back to normal processing (degraded mode) only if streaming didn't succeed
            if not response:
                print(f"Using normal processing mode for message")
                response = await self.router.process(platform, user_id, chat_id, content)
                
                # Send response to all targets
                print(f"Normal mode: sending to {len(response.targets)} targets")
                for target in response.targets:
                    await self.send_to_target(target, response.content)
                
        except Exception as e:
            error_msg = f"Error processing message: {str(e)}"
            await self.send_message(chat_id, error_msg)
    
    async def _re_enable_streaming(self):
        """Re-enable streaming mode after a delay"""
        import asyncio
        await asyncio.sleep(300)  # Wait 5 minutes before re-enabling streaming
        self.force_degraded_mode = False
        print(f"[{self.platform_name}] Streaming mode re-enabled after degraded mode period")
    
    async def send_to_target(self, target: str, content: str):
        """Send message to specific target (format: platform:chat_id)"""
        try:
            # Parse target format
            if ":" not in target:
                raise ValueError(f"Invalid target format: {target}")
            
            platform, chat_id = target.split(":", 1)
            
            # Get adapter for target platform
            adapter = self.router.adapters.get(platform)
            if not adapter:
                raise ValueError(f"No adapter found for platform: {platform}")
            
            # Send message directly without streaming to avoid duplicate initial messages
            await adapter.send_message(chat_id, content)
            
        except Exception as e:
            print(f"Error sending to target {target}: {e}")