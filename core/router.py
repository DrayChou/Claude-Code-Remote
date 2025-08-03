"""
Message Router - Ultra Simple Architecture
Handles message processing and routing to appropriate handlers
"""

import asyncio
import subprocess
import json
import re
import os
import time
import yaml
import logging
from datetime import datetime
from typing import Dict, Any, Optional
from adapters.base import Response

logger = logging.getLogger(__name__)


class MessageRouter:
    """Core message router - processes messages and returns responses"""
    
    def __init__(self, config_file: str = "config.yml"):
        """Initialize router with configuration"""
        self.config = self._load_config(config_file)
        self.adapters: Dict[str, Any] = {}  # Registered platform adapters
    
    def register_adapter(self, platform: str, adapter):
        """Register a platform adapter"""
        self.adapters[platform] = adapter
        print(f"Registered adapter for platform: {platform}")
    
    async def process(self, platform: str, user_id: str, chat_id: str, content: str) -> Response:
        """Process message and return response with targets"""
        try:
            # Check for built-in platform commands first
            builtin_response = self._handle_builtin_commands(platform, user_id, chat_id, content)
            if builtin_response:
                return builtin_response
            
            # Find appropriate handler
            handler_config = self._find_handler(content, user_id, platform)
            
            # Execute handler
            result = await self._execute_handler(handler_config, content)
            
            # Determine response targets
            targets = self._determine_targets(platform, user_id, chat_id, content, handler_config)
            
            return Response(content=result, targets=targets)
            
        except Exception as e:
            error_msg = f"Processing error: {str(e)}"
            return Response(content=error_msg, targets=[f"{platform}:{chat_id}"])
    
    async def process_with_streaming(self, platform: str, user_id: str, chat_id: str, content: str, adapter) -> Optional[Response]:
        """Process message with streaming support"""
        try:
            # Check for built-in platform commands first
            builtin_response = self._handle_builtin_commands(platform, user_id, chat_id, content)
            if builtin_response:
                return builtin_response
            
            # Find appropriate handler
            handler_config = self._find_handler(content, user_id, platform)
            
            # Only support streaming for shell handlers with PowerShell scripts
            handler_type = handler_config.get("type", "shell")
            command = handler_config.get("command", "")
            
            if handler_type == "shell" and command.lower().endswith('.ps1'):
                # Execute with streaming
                context = await adapter.start_streaming_response(chat_id)
                if context:
                    result = await self._execute_shell_handler_streaming(handler_config, content, adapter, context)
                    await adapter.finalize_streaming_response(context, result)
                    
                    # Determine response targets
                    targets = self._determine_targets(platform, user_id, chat_id, content, handler_config)
                    return Response(content=result, targets=targets)
            
            # Not suitable for streaming, return None to fall back to normal mode
            return None
            
        except Exception as e:
            print(f"Streaming processing error: {e}")
            return None
    
    def _load_config(self, config_file: str) -> Dict[str, Any]:
        """Load configuration from YAML file"""
        try:
            if os.path.exists(config_file):
                with open(config_file, 'r', encoding='utf-8') as f:
                    config = yaml.safe_load(f) or {}
                    # 替换环境变量
                    return self._expand_env_vars(config)
            else:
                # Return default configuration
                return {
                    "routes": {"default": "claude"},
                    "handlers": {
                        "claude": {
                            "type": "shell",
                            "command": os.getenv("CLAUDE_CLI_PATH", "claude"),
                            "args": ["{content}", "-p"]
                        }
                    }
                }
        except Exception as e:
            print(f"Error loading config: {e}")
            return {"routes": {"default": "claude"}, "handlers": {}}
    
    def _expand_env_vars(self, obj):
        """递归替换配置中的环境变量"""
        if isinstance(obj, dict):
            return {key: self._expand_env_vars(value) for key, value in obj.items()}
        elif isinstance(obj, list):
            return [self._expand_env_vars(item) for item in obj]
        elif isinstance(obj, str) and obj.startswith("${") and obj.endswith("}"):
            # 提取环境变量名
            env_var = obj[2:-1]
            return os.getenv(env_var, obj)  # 如果环境变量不存在，返回原值
        else:
            return obj
    
    def _find_handler(self, content: str, user_id: str, platform: str) -> Dict[str, Any]:
        """Find appropriate handler based on message content and configuration"""
        routes = self.config.get("routes", {})
        handlers = self.config.get("handlers", {})
        
        # Check command-based routing (支持新格式)
        commands = routes.get("commands", {})
        for command, route_config in commands.items():
            if content.startswith(command):
                # Handle both old and new format
                if isinstance(route_config, str):
                    # Old format: "/cmd": "handler_name"
                    handler_name = route_config
                    targets = ["origin"]
                else:
                    # New format: "/cmd": {"handler": "name", "targets": [...]}
                    handler_name = route_config.get("handler")
                    targets = route_config.get("targets", ["origin"])
                
                handler_config = handlers.get(handler_name, {}).copy()
                handler_config["name"] = handler_name
                handler_config["targets"] = targets
                
                # Remove command from content for processing
                clean_content = content[len(command):].strip()
                handler_config["content"] = clean_content if clean_content else content
                return handler_config
        
        # Check user-specific routing (支持新格式)
        user_routes = routes.get("users", {})
        if user_id in user_routes:
            user_config = user_routes[user_id]
            if isinstance(user_config, str):
                # Old format: "user_id": "handler_name"
                handler_name = user_config
                targets = ["origin"]
            else:
                # New format: "user_id": {"handler": "name", "targets": [...]}
                handler_name = user_config.get("handler")
                targets = user_config.get("targets", ["origin"])
            
            handler_config = handlers.get(handler_name, {}).copy()
            handler_config["name"] = handler_name
            handler_config["targets"] = targets
            handler_config["content"] = content
            return handler_config
        
        # Default handler
        default_handler = routes.get("default", "claude")
        handler_config = handlers.get(default_handler, {
            "type": "shell",
            "command": "claude",
            "args": ["{content}", "-p"]
        }).copy()
        handler_config["name"] = default_handler
        handler_config["targets"] = ["origin"]
        handler_config["content"] = content
        return handler_config
    
    async def _execute_handler(self, handler_config: Dict[str, Any], content: str) -> str:
        """Execute the appropriate handler"""
        handler_type = handler_config.get("type", "shell")
        
        # Use cleaned content from handler_config if available
        actual_content = handler_config.get("content", content)
        
        if handler_type == "shell":
            return await self._execute_shell_handler(handler_config, actual_content)
        elif handler_type == "api":
            return await self._execute_api_handler(handler_config, actual_content)
        else:
            return f"Unknown handler type: {handler_type}"
    
    async def _execute_shell_handler(self, handler_config: Dict[str, Any], content: str) -> str:
        """Execute shell command handler (like Claude CLI)"""
        try:
            command = handler_config.get("command", "claude")
            args = handler_config.get("args", ["{content}", "-p"])
            working_dir = handler_config.get("working_dir", os.getenv("CLAUDE_WORKING_DIR"))
            timeout = handler_config.get("timeout", 60)
            
            # Replace content placeholder in args
            processed_args = []
            for arg in args:
                if isinstance(arg, str):
                    processed_args.append(arg.replace("{content}", content))
                else:
                    processed_args.append(str(arg))
            
            # Build full command - use different methods for Windows
            if os.name == 'nt':  # Windows
                # 检查是否是PowerShell脚本
                if command.lower().endswith('.ps1'):
                    # 使用和原版相同的PowerShell命令格式
                    powershell_path = r'C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe'
                    
                    # 构建和原版相同的命令格式
                    cd_command = ""
                    if working_dir:
                        cd_command = f'cd "{working_dir}"; '
                    
                    # 使用完整的Claude参数（包括stream-json和verbose）
                    ps_command_str = f'''
                        [Console]::OutputEncoding = [Console]::InputEncoding = [System.Text.Encoding]::UTF8;
                        {cd_command}& "{command}" "{content}" -p --output-format stream-json --verbose
                    '''.replace('\n', ' ').strip()
                    
                    ps_command = [powershell_path, '-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', ps_command_str]
                    print(f"Executing PowerShell: {ps_command}")
                    
                    # 创建环境变量副本
                    ps_env = os.environ.copy()
                    ps_env.update({
                        'PYTHONIOENCODING': 'utf-8',
                        'LANG': 'zh_CN.UTF-8',
                        'PYTHONLEGACYWINDOWSSTDIO': '1'  # 修复Windows stdout问题
                    })
                    
                    # 使用同步subprocess避免asyncio问题
                    import subprocess
                    result = subprocess.run(
                        ps_command,
                        capture_output=True,
                        timeout=timeout
                    )
                    
                    print(f"Process return code: {result.returncode}")
                    if result.stderr:
                        print(f"Process stderr: {result.stderr.decode('utf-8', errors='replace')}")
                    if result.stdout:
                        print(f"Process stdout length: {len(result.stdout)}")
                    
                    if result.returncode == 0:
                        output = result.stdout.decode('utf-8', errors='replace')
                        return self._extract_claude_response(output)
                    else:
                        error_msg = result.stderr.decode('utf-8', errors='replace').strip()
                        return f"Command failed: {error_msg}"
                else:
                    # 其他命令使用shell方式
                    full_command = f'"{command}" ' + ' '.join(f'"{arg}"' for arg in processed_args)
                    print(f"Executing command: {full_command}")
                    
                    # 创建环境变量副本
                    shell_env = os.environ.copy()
                    shell_env.update({
                        'PYTHONIOENCODING': 'utf-8',
                        'LANG': 'zh_CN.UTF-8',
                        'PYTHONLEGACYWINDOWSSTDIO': '1'
                    })
                    
                    process = await asyncio.create_subprocess_shell(
                        full_command,
                        stdout=asyncio.subprocess.PIPE,
                        stderr=asyncio.subprocess.PIPE,
                        cwd=working_dir,
                        env=shell_env
                    )
            else:
                # Unix/Linux - use the original method
                full_command = [command] + processed_args
                print(f"Executing command: {' '.join(full_command)}")
                
                # 创建环境变量副本
                unix_env = os.environ.copy()
                unix_env.update({
                    'PYTHONIOENCODING': 'utf-8',
                    'LANG': 'zh_CN.UTF-8'
                })
                
                process = await asyncio.create_subprocess_exec(
                    *full_command,
                    stdout=asyncio.subprocess.PIPE,
                    stderr=asyncio.subprocess.PIPE,
                    cwd=working_dir,
                    env=unix_env
                )
            
            try:
                stdout, stderr = await asyncio.wait_for(process.communicate(), timeout=timeout)
            except asyncio.TimeoutError:
                process.kill()
                return f"Command timed out after {timeout} seconds"
            except Exception as e:
                print(f"Process communication error: {e}")
                return f"Process execution error: {str(e)}"
            
            print(f"Process return code: {process.returncode}")
            if stderr:
                print(f"Process stderr: {stderr.decode('utf-8', errors='replace')}")
            if stdout:
                print(f"Process stdout length: {len(stdout)}")
            
            if process.returncode != 0:
                error_msg = stderr.decode('utf-8', errors='replace').strip()
                print(f"Command failed with return code {process.returncode}: {error_msg}")
                return f"Command failed: {error_msg}"
            
            # Process output (handle JSON streaming like original)
            output = stdout.decode('utf-8', errors='replace')
            return self._extract_claude_response(output)
            
        except Exception as e:
            print(f"Shell handler exception: {e}")
            print(f"Exception type: {type(e)}")
            import traceback
            print(f"Traceback: {traceback.format_exc()}")
            return f"Handler execution error: {str(e)}"
    
    async def _execute_shell_handler_streaming(self, handler_config: Dict[str, Any], content: str, adapter, context) -> str:
        """Execute shell command handler with streaming support"""
        try:
            command = handler_config.get("command", "claude")
            args = handler_config.get("args", ["{content}", "-p"])
            working_dir = handler_config.get("working_dir", os.getenv("CLAUDE_WORKING_DIR"))
            timeout = handler_config.get("timeout", 60)
            
            # Use cleaned content from handler_config if available
            actual_content = handler_config.get("content", content)
            
            # Replace content placeholder in args
            processed_args = []
            for arg in args:
                if isinstance(arg, str):
                    processed_args.append(arg.replace("{content}", actual_content))
                else:
                    processed_args.append(str(arg))
            
            # Build streaming PowerShell command (like original implementation)
            if os.name == 'nt' and command.lower().endswith('.ps1'):
                powershell_path = r'C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe'
                
                # Build command like original version
                cd_command = ""
                if working_dir:
                    cd_command = f'cd "{working_dir}"; '
                
                ps_command_str = f'''
                    [Console]::OutputEncoding = [Console]::InputEncoding = [System.Text.Encoding]::UTF8;
                    {cd_command}& "{command}" "{actual_content}" -p --output-format stream-json --verbose
                '''.replace('\n', ' ').strip()
                
                ps_command = [powershell_path, '-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', ps_command_str]
                print(f"Executing PowerShell streaming: {ps_command}")
                
                # Start process for streaming
                import subprocess
                process = subprocess.Popen(
                    ps_command,
                    stdout=subprocess.PIPE,
                    stderr=subprocess.PIPE,
                    text=True,
                    encoding='utf-8',
                    bufsize=1
                )
                
                assistant_response_parts = []
                
                # Real-time reading (based on original implementation)
                while True:
                    output_line = process.stdout.readline()
                    if output_line == '' and process.poll() is not None:
                        break
                    
                    if output_line:
                        line = output_line.strip()
                        if not line:
                            continue
                        
                        # Parse streaming JSON output
                        partial_response = self._parse_streaming_line(line, assistant_response_parts)
                        if partial_response and context.should_update(partial_response):
                            # Update message in real-time
                            success = await adapter.update_streaming_response(context, partial_response)
                            if success:
                                context.last_content = partial_response
                                context.last_update_time = time.time()
                
                # Wait for process completion
                stderr_output = process.stderr.read()
                return_code = process.wait()
                
                # Return final response
                final_response = ''.join(assistant_response_parts)
                if final_response:
                    return self._clean_response_content(final_response)
                else:
                    return "No response received from Claude"
            
            else:
                # Not suitable for streaming, fallback to normal execution
                return await self._execute_shell_handler(handler_config, actual_content)
                
        except Exception as e:
            print(f"Streaming handler exception: {e}")
            return f"Streaming execution error: {str(e)}"
    
    def _parse_streaming_line(self, line: str, assistant_parts: list) -> str:
        """Parse a single line of Claude streaming JSON output"""
        try:
            json_data = json.loads(line)
            
            # Check for assistant message content (based on original logic)
            if (json_data.get('type') == 'assistant' and 
                json_data.get('message') and 
                json_data['message'].get('content')):
                
                for content in json_data['message']['content']:
                    if content.get('type') == 'text' and content.get('text'):
                        text_content = content['text']
                        # Clean content before adding
                        cleaned_text = self._clean_response_content(text_content)
                        if cleaned_text:
                            assistant_parts.append(cleaned_text)
                
                # Return current accumulated response
                return ''.join(assistant_parts)
                        
        except json.JSONDecodeError:
            pass
        
        return ""
    
    async def _execute_api_handler(self, handler_config: Dict[str, Any], content: str) -> str:
        """Execute API handler - placeholder for future API integrations"""
        return f"API handler not implemented yet"
    
    def _extract_claude_response(self, output: str) -> str:
        """Extract Claude response from command output (using original logic)"""
        if not output or not output.strip():
            return "Command executed but no response received."
        
        # 尝试解析JSON流式输出（基于原版逻辑）
        lines = output.split('\n')
        assistant_response_parts = []
        final_result = ""
        
        for line in lines:
            line = line.strip()
            if not line:
                continue
                
            try:
                json_data = json.loads(line)
                
                # 累积助手消息内容（流式输出的每一部分）
                if (json_data.get('type') == 'assistant' and 
                    json_data.get('message') and 
                    json_data['message'].get('content')):
                    
                    for content in json_data['message']['content']:
                        if content.get('type') == 'text' and content.get('text'):
                            assistant_response_parts.append(content['text'])
                
                # 从结果中提取最终回复
                if (json_data.get('type') == 'result' and 
                    json_data.get('subtype') == 'success' and 
                    json_data.get('result')):
                    final_result = json_data['result']
                        
            except json.JSONDecodeError:
                continue
        
        # 优先使用累积的助手消息，如果没有则使用最终结果
        if assistant_response_parts:
            assistant_response = ''.join(assistant_response_parts)
        elif final_result:
            assistant_response = final_result
        else:
            assistant_response = ""
        
        # 如果没有找到JSON格式的回复，使用文本清理
        if not assistant_response:
            clean_lines = []
            found_content = False
            
            for line in lines:
                clean_line = line.strip()
                
                # 跳过系统消息和PowerShell输出
                if (clean_line.startswith('"type":"system"') or
                    'Executing:' in clean_line or
                    'Node.js' in clean_line or
                    'DEP0190' in clean_line or
                    'DeprecationWarning' in clean_line or
                    'Windows PowerShell' in clean_line or
                    '版权所有' in clean_line or
                    clean_line.startswith('Microsoft') or
                    clean_line.startswith('执行完成') or
                    not clean_line):
                    continue
                
                if not found_content and clean_line:
                    found_content = True
                
                if found_content:
                    clean_lines.append(clean_line)
            
            assistant_response = '\n'.join(clean_lines).strip()
        
        # 如果仍然没有内容，返回默认消息
        if not assistant_response:
            if output:
                # 返回输出摘要
                summary = ' '.join(output.split()).strip()
                assistant_response = (summary[:200] + '...') if len(summary) > 200 else summary
            else:
                assistant_response = "Command executed but no response received."
        
        # 最终清理响应内容
        assistant_response = self._clean_response_content(assistant_response)
        return assistant_response
    
    def _clean_response_content(self, content: str) -> str:
        """Clean response content (from original code)"""
        if not content:
            return ""
        
        # Remove "(no content)" patterns
        patterns_to_remove = [
            r'\(no content\)',
            r'\(no\s+content\)',
            r'\(\s*no\s+content\s*\)',
        ]
        
        for pattern in patterns_to_remove:
            content = re.sub(pattern, '', content, flags=re.IGNORECASE)
        
        # Clean up extra whitespace
        content = re.sub(r'\n\s*\n\s*\n', '\n\n', content)
        content = content.strip()
        
        return content if content else "Response processed but no content to display"
    
    def _determine_targets(self, platform: str, user_id: str, chat_id: str, content: str, handler_config: Dict[str, Any]) -> list[str]:
        """Determine where to send the response"""
        # Get targets from handler config (支持一对多)
        targets = handler_config.get("targets", ["origin"])
        
        # 解析目标别名
        target_aliases = self.config.get("target_aliases", {})
        resolved_targets = []
        
        for target in targets:
            if target == "origin":
                # 原路返回
                resolved_targets.append(f"{platform}:{chat_id}")
            elif target in target_aliases:
                # 使用别名 - 支持数组类型别名
                alias_value = target_aliases[target]
                if isinstance(alias_value, list):
                    # 数组别名，展开所有目标
                    resolved_targets.extend(alias_value)
                else:
                    # 单个别名
                    resolved_targets.append(alias_value)
            else:
                # 直接使用目标
                resolved_targets.append(target)
        
        return resolved_targets
    
    def _handle_builtin_commands(self, platform: str, user_id: str, chat_id: str, content: str) -> Optional[Response]:
        """Handle built-in platform commands like /id"""
        command = content.lower().strip()
        
        # /id command - show user and chat IDs (works on all platforms)
        if command in ['/id', 'id', '#id']:
            # Get username from adapter if available
            adapter = self.adapters.get(platform)
            username = getattr(adapter, '_get_username', lambda uid: None)(user_id) or "unknown"
            
            id_info = f"Platform: {platform.title()}\nUser ID: {user_id}\nChat ID: {chat_id}"
            if username != "unknown":
                id_info += f"\nUsername: @{username}"
            
            print(f"Handling built-in /id command for user {user_id} on {platform}")
            return Response(content=id_info, targets=[f"{platform}:{chat_id}"])
        
        # /help command - show available commands
        if command in ['/help', 'help', '#help']:
            help_text = self._generate_help_text(platform)
            return Response(content=help_text, targets=[f"{platform}:{chat_id}"])
        
        # /ping command - simple response test
        if command in ['/ping', 'ping', '#ping']:
            ping_response = f"Pong from {platform.title()}!\nTime: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}"
            return Response(content=ping_response, targets=[f"{platform}:{chat_id}"])
        
        # /status command - show system status
        if command in ['/status', 'status', '#status']:
            status_info = self._get_system_status(platform)
            return Response(content=status_info, targets=[f"{platform}:{chat_id}"])
        
        return None
    
    def _generate_help_text(self, platform: str) -> str:
        """Generate help text based on available commands"""
        routes = self.config.get("routes", {})
        commands = routes.get("commands", {})
        
        help_lines = [
            f"{platform.title()} Bot Help",
            "",
            "Built-in Commands:",
            "* /id - Show your user and chat IDs",
            "* /help - Show this help message", 
            "* /ping - Test bot response",
            "* /status - Show system status",
            "",
            "Custom Commands:"
        ]
        
        for command, config in commands.items():
            if isinstance(config, dict):
                handler_name = config.get("handler", "unknown")
                targets = config.get("targets", ["origin"])
                target_info = " (broadcast)" if len(targets) > 1 else ""
                help_lines.append(f"* {command} - Use {handler_name} handler{target_info}")
            else:
                help_lines.append(f"* {command} - Use {config} handler")
        
        return "\n".join(help_lines)
    
    def _get_system_status(self, platform: str) -> str:
        """Get system status information"""
        from datetime import datetime
        import psutil
        import os
        
        try:
            # Get basic system info
            cpu_percent = psutil.cpu_percent(interval=1)
            memory = psutil.virtual_memory()
            
            status_lines = [
                f"System Status ({platform.title()})",
                f"Time: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}",
                f"CPU: {cpu_percent:.1f}%",
                f"Memory: {memory.percent:.1f}%",
                f"Working Dir: {os.getcwd()}",
                "",
                f"Registered Adapters: {len(self.adapters)}",
                f"Available Handlers: {len(self.config.get('handlers', {}))}"
            ]
            
            return "\n".join(status_lines)
            
        except Exception as e:
            return f"System Status\nError getting status: {str(e)}"