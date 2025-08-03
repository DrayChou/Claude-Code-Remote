"""
Platform Adapter Base Class - Ultra Simple Architecture
Two-layer design: Platform Adapters + Core Router
"""

from abc import ABC, abstractmethod
from typing import Dict, Any, Optional
from dataclasses import dataclass
import time


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
    
    async def on_message(self, platform: str, user_id: str, chat_id: str, content: str):
        """Universal message handler - called when message is received"""
        try:
            # Check if streaming is supported and try streaming mode first
            if await self.supports_streaming():
                try:
                    # Try streaming mode processing
                    if hasattr(self.router, 'process_with_streaming'):
                        response = await self.router.process_with_streaming(platform, user_id, chat_id, content, self)
                        if response:
                            # Streaming mode handled the response, send to other targets if any
                            for target in response.targets:
                                if target != f"{platform}:{chat_id}":  # Skip origin target (already handled by streaming)
                                    await self.send_to_target(target, response.content)
                            return
                except Exception as e:
                    print(f"Streaming mode failed, falling back to normal mode: {e}")
            
            # Fall back to normal processing
            response = await self.router.process(platform, user_id, chat_id, content)
            
            # Send response to all targets
            for target in response.targets:
                await self.send_to_target(target, response.content)
                
        except Exception as e:
            error_msg = f"Error processing message: {str(e)}"
            await self.send_message(chat_id, error_msg)
    
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
            
            # Send message
            await adapter.send_message(chat_id, content)
            
        except Exception as e:
            print(f"Error sending to target {target}: {e}")