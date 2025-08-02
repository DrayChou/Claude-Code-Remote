#!/usr/bin/env node

/**
 * Tmux Command Injector - Unattended remote control solution
 */

const { exec } = require('child_process');
const fs = require('fs');
const path = require('path');

class TmuxInjector {
    constructor(logger, sessionName = null) {
        this.log = logger || console;
        this.sessionName = sessionName || 'claude-taskping';
        this.logFile = path.join(__dirname, '../logs/tmux-injection.log');
        this.isWindows = false;
        this.isWSL = false;
        this.ensureLogDir();
    }
    
    ensureLogDir() {
        const logDir = path.dirname(this.logFile);
        if (!fs.existsSync(logDir)) {
            fs.mkdirSync(logDir, { recursive: true });
        }
    }
    
    // Check if tmux is installed
    async checkTmuxAvailable() {
        return new Promise((resolve) => {
            const platform = process.platform;
            
            if (platform === 'win32') {
                // On Windows, check for WSL or tmux alternatives
                exec('wsl tmux -V', (wslError) => {
                    if (!wslError) {
                        this.isWSL = true;
                        this.log.info('Using tmux via WSL');
                        resolve(true);
                    } else {
                        // Try checking for PowerShell (always available on Windows)
                        this.log.info('tmux not available on Windows, using PowerShell alternative');
                        this.isWindows = true;
                        resolve(true); // PowerShell is always available
                    }
                });
            } else {
                exec('which tmux', (error) => {
                    resolve(!error);
                });
            }
        });
    }
    
    // Check if Claude tmux session exists
    async checkClaudeSession() {
        return new Promise((resolve) => {
            exec(`tmux has-session -t ${this.sessionName} 2>/dev/null`, (error) => {
                resolve(!error);
            });
        });
    }
    
    // Create Claude tmux session
    async createClaudeSession() {
        return new Promise((resolve) => {
            // Use clauderun command to start Claude (without pre-filling any commands)
            const command = `tmux new-session -d -s ${this.sessionName} -c "${process.cwd()}" clauderun`;
            
            this.log.info(`Creating tmux session with clauderun command: ${command}`);
            
            exec(command, (error, stdout, stderr) => {
                if (error) {
                    this.log.warn(`Failed to create tmux session with clauderun: ${error.message}`);
                    // If clauderun fails, try using full path command
                    this.log.info('Fallback to full path command...');
                    const fallbackCommand = `tmux new-session -d -s ${this.sessionName} -c "${process.cwd()}" /Users/jessytsui/.nvm/versions/node/v18.17.0/bin/claude --dangerously-skip-permissions`;
                    
                    exec(fallbackCommand, (fallbackError) => {
                        if (fallbackError) {
                            this.log.error(`Failed to create tmux session with fallback: ${fallbackError.message}`);
                            resolve({ success: false, error: fallbackError.message });
                        } else {
                            this.log.info('Tmux Claude session created successfully (full path)');
                            setTimeout(() => {
                                resolve({ success: true });
                            }, 3000);
                        }
                    });
                } else {
                    this.log.info('Tmux Claude session created successfully (clauderun)');
                    // Wait for Claude initialization
                    setTimeout(() => {
                        resolve({ success: true });
                    }, 3000);
                }
            });
        });
    }
    
    // Inject command into tmux session (intelligently handle Claude confirmations)
    async injectCommand(sessionName, command, options = {}) {
        return new Promise(async (resolve) => {
            try {
                // Check platform and tmux availability first
                const tmuxAvailable = await this.checkTmuxAvailable();
                
                this.log.debug(`Injecting command via ${this.isWindows ? 'PowerShell' : 'tmux'}: ${sessionName}`);
                
                if (this.isWindows || !tmuxAvailable) {
                    // Windows fallback: Use Claude headless mode
                    const result = await this.injectCommandWindows(command, options);
                    resolve(result);
                    return;
                }
                
                // Original tmux logic for Unix systems
                const tmuxSession = sessionName || this.sessionName;
                
                // 1. Clear input field
                const clearCommand = this.isWSL ? 
                    `wsl tmux send-keys -t ${tmuxSession} C-u` :
                    `tmux send-keys -t ${tmuxSession} C-u`;
                
                // 2. Send command
                const escapedCommand = command.replace(/'/g, "'\"'\"'");
                const sendCommand = this.isWSL ?
                    `wsl tmux send-keys -t ${tmuxSession} '${escapedCommand}'` :
                    `tmux send-keys -t ${tmuxSession} '${escapedCommand}'`;
                
                // 3. Send enter
                const enterCommand = this.isWSL ?
                    `wsl tmux send-keys -t ${tmuxSession} C-m` :
                    `tmux send-keys -t ${tmuxSession} C-m`;
                
                // Execute three steps
                exec(clearCommand, (clearError) => {
                    if (clearError) {
                        this.log.error(`Failed to clear input: ${clearError.message}`);
                        resolve({ success: false, error: clearError.message });
                        return;
                    }
                    
                    // Brief wait
                    setTimeout(() => {
                        exec(sendCommand, (sendError) => {
                            if (sendError) {
                                this.log.error(`Failed to send command: ${sendError.message}`);
                                resolve({ success: false, error: sendError.message });
                                return;
                            }
                            
                            // Brief wait
                            setTimeout(() => {
                                exec(enterCommand, async (enterError) => {
                                    if (enterError) {
                                        this.log.error(`Failed to send enter: ${enterError.message}`);
                                        resolve({ success: false, error: enterError.message });
                                        return;
                                    }
                                    
                                    this.log.debug('Command sent successfully in 3 steps');
                                    
                                    // Brief wait for command sending
                                    await new Promise(r => setTimeout(r, 1000));
                                    
                                    // Check if command is already displayed in Claude
                                    const capture = await this.getCaptureOutput();
                                    if (capture.success) {
                                        this.log.debug(`Claude state after injection: ${capture.output.slice(-200).replace(/\n/g, ' ')}`);
                                    }
                                    
                                    // Wait and check if confirmation is needed
                                    await this.handleConfirmations();
                                    
                                    // Record injection log
                                    this.logInjection(command);
                                    
                                    resolve({ success: true });
                                });
                            }, 200);
                        });
                    }, 200);
                });
                
            } catch (error) {
                resolve({ success: false, error: error.message });
            }
        });
    }
    
    // Detect Claude CLI path intelligently on Windows
    async detectClaudePath() {
        const envPath = process.env.CLAUDE_CLI_PATH;
        if (envPath) {
            this.log.info(`🔧 Using configured CLAUDE_CLI_PATH: ${envPath}`);
            return envPath;
        }
        
        // Try common Windows paths - prioritize cc.tuzi.ps1 script
        const commonPaths = [
            'C:\\Users\\dray\\scoop\\shims\\cc.tuzi.ps1',
            process.env.USERPROFILE + '\\scoop\\shims\\cc.tuzi.ps1',
            'C:\\Users\\dray\\scoop\\shims\\claude.cmd',
            process.env.USERPROFILE + '\\scoop\\shims\\claude.cmd',
            'claude'
        ];
        
        for (const testPath of commonPaths) {
            try {
                const fs = require('fs');
                if (testPath === 'claude' || fs.existsSync(testPath)) {
                    this.log.info(`✅ Found Claude CLI at: ${testPath}`);
                    return testPath;
                }
            } catch (error) {
                // Continue to next path
            }
        }
        
        this.log.warn('⚠️ No Claude CLI path found, using default "claude"');
        return 'claude';
    }
    
    // Windows-specific command injection using Claude headless mode
    async injectCommandWindows(command, options = {}) {
        try {
            this.log.info('Windows detected: Using Claude headless mode');
            this.log.debug(`Original command: ${command}`);
            
            // Execute Claude command using detected path
            const claudePath = await this.detectClaudePath();
            
            // Build command with proper cross-platform handling
            let claudeCommand;
            let childProcess;
            
            // Build base arguments
            let args = ['-p'];
            if (options.sessionId) {
                args.push('--session-id', options.sessionId);
            }
            if (options.model) {
                args.push('--model', options.model);
            }
            if (options.continue) {
                args.push('--continue');
            }
            if (options.permissionMode) {
                args.push('--permission-mode', options.permissionMode);
            }
            
            // 简化的跨平台命令构建逻辑
            if (process.platform === 'win32') {
                // Windows 平台处理
                if (claudePath.includes('.ps1')) {
                    // PowerShell 脚本文件 - 直接调用claude命令避免脚本输出
                    claudeCommand = `powershell -NoProfile -ExecutionPolicy Bypass -Command "[Console]::InputEncoding = [Console]::OutputEncoding = New-Object System.Text.UTF8Encoding; claude '${command}' ${args.join(' ')}"`;
                } else if (claudePath.includes('powershell')) {
                    // 包含 powershell 的完整命令
                    claudeCommand = `${claudePath} "${command}" ${args.join(' ')}`;
                } else {
                    // 默认 claude 命令或其他可执行文件
                    claudeCommand = `${claudePath} "${command}" ${args.join(' ')}`;
                }
            } else {
                // Unix/Linux/macOS 平台
                claudeCommand = `${claudePath} "${command}" ${args.join(' ')}`;
            }
            
            this.log.debug(`Executing: ${claudeCommand}`);
            
            if (options.streaming && options.onStream) {
                return this._executeStreamingCommand(claudeCommand, options, command);
            }
            
            return new Promise((resolve) => {
                childProcess = exec(claudeCommand, {
                    cwd: process.cwd(),
                    env: { ...process.env, PYTHONIOENCODING: 'utf-8' },
                    encoding: 'utf8',
                    maxBuffer: 1024 * 1024 * 10, // 10MB buffer
                    shell: true
                }, (error, stdout, stderr) => {
                    if (error) {
                        this.log.error(`Claude execution failed: ${error.message}`);
                        
                        // Check if it's an authentication issue
                        if (stderr.includes('Invalid API key') || stderr.includes('Please run /login')) {
                            resolve({ 
                                success: false, 
                                error: 'authentication_required',
                                message: 'Claude authentication required. Please run: claude --login'
                            });
                        } else {
                            resolve({ 
                                success: false, 
                                error: error.message,
                                message: `Claude execution failed: ${error.message}`
                            });
                        }
                    } else {
                        this.log.info('Claude command executed successfully');
                        this.log.debug(`Claude output length: ${stdout.length} characters`);
                        this.log.debug(`Claude output preview: ${stdout.substring(0, 100)}...`);
                        
                        const result = { 
                            success: true, 
                            method: 'headless', 
                            message: 'Command executed via Claude headless mode',
                            output: stdout
                        };
                        
                        this.log.debug('Resolving with result:', JSON.stringify(result, null, 2));
                        resolve(result);
                    }
                });
                
                // Log the process start
                this.log.debug(`Started Claude process with PID: ${childProcess.pid}`);
            });
            
        } catch (error) {
            this.log.error(`Windows injection failed: ${error.message}`);
            return { success: false, error: error.message };
        }
    }
    
    // Execute streaming command with multiple fallback methods
    async _executeStreamingCommand(claudeCommand, options, originalCommand) {
        this.log.info(`🚀 EXECUTING COMMAND WITH FALLBACK METHODS: ${originalCommand}`);
        
        // Try different execution methods in order
        const executionMethods = [
            () => this._executeWithExec(originalCommand, options),
            () => this._executeWithDirectSpawn(originalCommand, options),
            () => this._executeWithPowerShellCommand(originalCommand, options),
            () => this._executeWithOriginalMethod(claudeCommand, options, originalCommand)
        ];
        
        let currentMethodIndex = 0;
        
        const tryNextMethod = (error) => {
            if (currentMethodIndex < executionMethods.length) {
                this.log.warn(`⚠️  Method ${currentMethodIndex} failed: ${error.message}`);
                this.log.info(`🔄 Trying method ${currentMethodIndex + 1} of ${executionMethods.length}`);
                
                const nextMethod = executionMethods[currentMethodIndex];
                currentMethodIndex++;
                
                try {
                    const result = nextMethod();
                    if (result && typeof result.then === 'function') {
                        result.then(() => {
                            this.log.info(`✅ Method ${currentMethodIndex} succeeded`);
                        }).catch(tryNextMethod);
                    }
                } catch (err) {
                    tryNextMethod(err);
                }
            } else {
                this.log.error(`❌ All execution methods failed`);
            }
        };
        
        // Start with the first method
        try {
            const firstMethod = executionMethods[currentMethodIndex];
            currentMethodIndex++;
            const result = firstMethod();
            
            if (result && typeof result.then === 'function') {
                result.catch(tryNextMethod);
            }
        } catch (error) {
            tryNextMethod(error);
        }
    }
    
    // Original method as fallback
    async _executeWithOriginalMethod(claudeCommand, options, originalCommand) {
        const { spawn } = require('child_process');
        
        return new Promise(async (resolve) => {
            // 获取Claude CLI路径，支持跨平台
            const claudePath = process.platform === 'win32' ? await this.detectClaudePath() : (process.env.CLAUDE_CLI_PATH || 'claude');
            
            // 构建完整命令，根据平台和配置处理
            let fullCommand;
            
            this.log.info(`🔧 Platform: ${process.platform}`);
            this.log.info(`🔧 claudePath: "${claudePath}"`);
            this.log.info(`🔧 originalCommand: "${originalCommand}"`);
            
            // 简化的跨平台检测逻辑
            if (process.platform === 'win32') {
                // Windows 平台处理
                this.log.info(`🎯 Windows platform detected`);
                
                const utf8Setup = '[Console]::InputEncoding = [Console]::OutputEncoding = New-Object System.Text.UTF8Encoding; ';
                
                if (claudePath.includes('.ps1')) {
                    // PowerShell 脚本文件 - 使用配置的脚本路径
                    this.log.info(`📝 Using configured PowerShell script: ${claudePath}`);
                    // 使用配置的脚本路径，构建完整的PowerShell命令
                    const scriptCommand = `& '${claudePath}' '${originalCommand}' -p --output-format stream-json --verbose ${options.sessionId ? '--session-id ' + options.sessionId : ''}`;
                    fullCommand = `powershell -NoProfile -ExecutionPolicy Bypass -Command "${utf8Setup}${scriptCommand}"`;
                } else if (claudePath.includes('powershell')) {
                    // 包含 powershell 的完整命令
                    this.log.info(`⚡ Using full PowerShell command: ${claudePath}`);
                    fullCommand = `${claudePath} "${utf8Setup}${originalCommand}" -p --output-format stream-json --verbose ${options.sessionId ? '--session-id ' + options.sessionId : ''}`;
                } else {
                    // 默认 claude 命令或其他可执行文件
                    this.log.info(`🚀 Using default Windows command: ${claudePath}`);
                    // 尝试直接调用，如果失败则使用 PowerShell 包装
                    fullCommand = `${claudePath} "${originalCommand}" -p --output-format stream-json --verbose ${options.sessionId ? '--session-id ' + options.sessionId : ''}`;
                }
            } else {
                // Unix/Linux/macOS 平台
                this.log.info(`🐧 Unix/Linux/macOS platform detected`);
                fullCommand = `${claudePath} "${originalCommand}" -p --output-format stream-json --verbose ${options.sessionId ? '--session-id ' + options.sessionId : ''}`;
            }
            
            this.log.info(`🚀 STREAMING COMMAND DEBUG:`);
            this.log.info(`   claudePath: ${claudePath}`);
            this.log.info(`   originalCommand: ${originalCommand}`);
            this.log.info(`   sessionId: ${options.sessionId}`);
            this.log.info(`   fullCommand: ${fullCommand}`);
            
            let childProcess;
            
            if (process.platform === 'win32') {
                // Windows平台使用spawn
                const args = ['/NoProfile', '/ExecutionPolicy', 'Bypass', '/Command', fullCommand];
                this.log.info(`🖥️  SPAWNING POWERSHELL PROCESS:`);
                this.log.info(`   Command: powershell.exe`);
                this.log.info(`   Args: ${JSON.stringify(args)}`);
                this.log.info(`   Working Directory: ${process.cwd()}`);
                this.log.info(`   Environment: PYTHONIOENCODING=utf-8, NODE_ENV=production`);
                
                childProcess = spawn('powershell.exe', args, {
                    cwd: process.cwd(),
                    env: { 
                        ...process.env, 
                        PYTHONIOENCODING: 'utf-8',
                        NODE_ENV: 'production',
                        NODE_NO_WARNINGS: '1'  // 禁用 Node.js 警告
                    },
                    encoding: 'utf8',
                    windowsHide: true
                });
            } else {
                // Unix/Linux/macOS平台使用spawn
                const args = fullCommand.split(' ');
                this.log.info(`🖥️  SPAWNING UNIX PROCESS:`);
                this.log.info(`   Command: ${args[0]}`);
                this.log.info(`   Args: ${JSON.stringify(args.slice(1))}`);
                this.log.info(`   Working Directory: ${process.cwd()}`);
                this.log.info(`   Environment: PYTHONIOENCODING=utf-8, NODE_ENV=production`);
                
                childProcess = spawn(args[0], args.slice(1), {
                    cwd: process.cwd(),
                    env: { 
                        ...process.env, 
                        PYTHONIOENCODING: 'utf-8',
                        NODE_ENV: 'production'
                    },
                    encoding: 'utf8'
                });
            }
            
            // 添加进程启动日志
            this.log.info(`🚀 PROCESS STARTED:`);
            this.log.info(`   PID: ${childProcess.pid}`);
            this.log.info(`   Platform: ${process.platform}`);
            this.log.info(`   Spawn Time: ${new Date().toISOString()}`);
            
            // 监听进程事件
            childProcess.on('spawn', () => {
                this.log.info(`✅ PROCESS SPAWNED SUCCESSFULLY: PID ${childProcess.pid}`);
            });
            
            childProcess.on('exit', (code, signal) => {
                this.log.info(`🏁 PROCESS EXITED:`);
                this.log.info(`   PID: ${childProcess.pid}`);
                this.log.info(`   Exit Code: ${code}`);
                this.log.info(`   Signal: ${signal}`);
                this.log.info(`   Exit Time: ${new Date().toISOString()}`);
            });
            
            childProcess.on('disconnect', () => {
                this.log.info(`🔌 PROCESS DISCONNECTED: PID ${childProcess.pid}`);
            });
            
            // 保存原始childProcess引用
            
            let streamBuffer = '';
            let processedLines = 0;
            
            this.log.debug(`Started streaming Claude process with PID: ${childProcess.pid}`);
            
            // Handle stdout (streaming data) - spawn方式处理Buffer
            childProcess.stdout.on('data', (data) => {
                const chunk = data.toString('utf8');
                this.log.info(`📥 STDOUT CHUNK (${chunk.length} chars): ${chunk.substring(0, 200)}...`);
                this.log.debug(`🔍 RAW CHUNK CONTENT: ${chunk}`);
                streamBuffer += chunk;
                this.log.info(`📊 Total buffer size: ${streamBuffer.length} chars`);
                
                // Process complete JSON lines
                const lines = streamBuffer.split('\n');
                streamBuffer = lines.pop() || ''; // Keep the incomplete last line
                
                this.log.info(`📋 PROCESSING ${lines.length} lines`);
                this.log.debug(`📝 REMAINING BUFFER: "${streamBuffer}"`);
                
                for (let i = processedLines; i < lines.length; i++) {
                    const trimmedLine = lines[i].trim();
                    if (trimmedLine) {
                        this.log.info(`🔍 Processing line ${i+1}: "${trimmedLine.substring(0, 100)}..."`);
                        this.log.debug(`🔍 FULL LINE CONTENT: "${trimmedLine}"`);
                        
                        // Less restrictive filtering - only skip obvious PowerShell noise
                        if (trimmedLine.startsWith('Executing:') || 
                            trimmedLine.includes('PS>') ||
                            trimmedLine.match(/^\[.*\]$/) && trimmedLine.includes('System.Text') || // 只过滤System.Text相关的系统消息
                            trimmedLine.match(/^& /) || // 过滤 PowerShell & 操作符
                            trimmedLine.length === 0 ||
                            trimmedLine === 'powershell' ||
                            trimmedLine === 'PS>') {
                            this.log.debug(`🚫 Skipping PowerShell noise: "${trimmedLine.substring(0, 50)}..."`);
                            continue;
                        }
                        
                        // Log all non-filtered content for debugging
                        this.log.info(`📄 Candidate content: "${trimmedLine.substring(0, 100)}..."`);
                        
                        // Try to parse as JSON first
                        if (trimmedLine.startsWith('{') || trimmedLine.startsWith('[')) {
                            try {
                                const parsed = JSON.parse(trimmedLine);
                                this.log.info(`✅ JSON parsed successfully, type: ${parsed.type}`);
                                this.log.debug(`📋 PARSED OBJECT: ${JSON.stringify(parsed, null, 2)}`);
                                
                                // Handle different message types
                                if (parsed.type === 'assistant' && parsed.message && parsed.message.content) {
                                    this.log.info(`🤖 Assistant message found with ${parsed.message.content.length} content items`);
                                    // Extract text content from Claude response
                                    for (const contentItem of parsed.message.content) {
                                        if (contentItem.type === 'text' && contentItem.text) {
                                            this.log.info(`📝 Sending text to stream: ${contentItem.text.substring(0, 50)}...`);
                                            this.log.debug(`📝 FULL TEXT CONTENT: "${contentItem.text}"`);
                                            if (options.onStream) {
                                                options.onStream(contentItem.text);
                                            }
                                        }
                                    }
                                } else if (parsed.type === 'result' && parsed.result) {
                                    this.log.info(`🎯 Final result found: ${parsed.result.substring(0, 50)}...`);
                                    this.log.debug(`🎯 FULL RESULT: "${parsed.result}"`);
                                    // Final result - send as stream chunk
                                    if (options.onStream) {
                                        options.onStream('\n\n**Final Result:**\n' + parsed.result);
                                    }
                                } else {
                                    this.log.info(`📋 Other message type: ${parsed.type}`);
                                    this.log.debug(`📋 OTHER MESSAGE: ${JSON.stringify(parsed, null, 2)}`);
                                }
                            } catch (parseError) {
                                this.log.warn(`❌ JSON parse failed for potential JSON line: "${trimmedLine.substring(0, 100)}..."`);
                                this.log.warn(`❌ Parse error details: ${parseError.message}`);
                                // If it looks like JSON but fails to parse, still send as text
                                if (options.onStream) {
                                    options.onStream(trimmedLine + '\n');
                                }
                            }
                        } else {
                            // Non-JSON text - check if it might be Claude response
                            // Less restrictive filtering for Claude responses
                            if (!trimmedLine.includes('Warning:') && 
                                !trimmedLine.includes('DeprecationWarning:') &&
                                !trimmedLine.includes('(node:') &&
                                !trimmedLine.startsWith('Starting Claude in interactive mode') &&
                                !trimmedLine.includes('Script location:') &&
                                !trimmedLine.includes('Working directory:') &&
                                !trimmedLine.includes('Environment check:') &&
                                !trimmedLine.includes('ANTHROPIC_API_KEY:') &&
                                !trimmedLine.includes('ANTHROPIC_BASE_URL:') &&
                                !trimmedLine.includes('Using claude path:')) {
                                
                                this.log.info(`📤 Sending potential Claude response: "${trimmedLine.substring(0, 50)}..."`);
                                if (options.onStream) {
                                    options.onStream(trimmedLine + '\n');
                                }
                            } else {
                                this.log.debug(`🚫 Skipping system message: "${trimmedLine.substring(0, 50)}..."`);
                            }
                        }
                    }
                    processedLines = i + 1;
                }
            });
            
            // Handle stderr
            childProcess.stderr.on('data', (data) => {
                const errorText = data.toString('utf8');
                this.log.warn(`🚨 STDERR: ${errorText}`);
                
                if (errorText.includes('Invalid API key') || errorText.includes('Please run /login')) {
                    this.log.error(`🔐 Authentication error detected`);
                    resolve({ 
                        success: false, 
                        error: 'authentication_required',
                        message: 'Claude authentication required. Please run: claude --login'
                    });
                }
            });
            
            // Handle process completion
            childProcess.on('close', (code) => {
                this.log.info(`🏁 PROCESS CLOSED:`);
                this.log.info(`   PID: ${childProcess.pid}`);
                this.log.info(`   Exit Code: ${code}`);
                this.log.info(`   Close Time: ${new Date().toISOString()}`);
                this.log.info(`   Final Buffer Size: ${streamBuffer.length} chars`);
                this.log.info(`   Total Lines Processed: ${processedLines}`);
                
                // Process any remaining buffer content
                if (streamBuffer.trim()) {
                    this.log.info(`📄 Processing remaining buffer content before completion`);
                    this.log.debug(`📄 REMAINING CONTENT: "${streamBuffer.substring(0, 200)}..."`);
                    
                    // Try to extract any final content
                    const remainingLines = streamBuffer.split('\n');
                    for (const line of remainingLines) {
                        const trimmedLine = line.trim();
                        if (trimmedLine && !this._shouldFilterLine(trimmedLine)) {
                            this.log.info(`📤 Sending remaining content: "${trimmedLine.substring(0, 50)}..."`);
                            if (options.onStream) {
                                options.onStream(trimmedLine + '\n');
                            }
                        }
                    }
                }
                
                if (code === 0) {
                    this.log.info('✅ Streaming Claude command completed successfully');
                    this.log.debug(`📄 FINAL OUTPUT PREVIEW: ${streamBuffer.substring(0, 500)}...`);
                    
                    // Send completion message
                    if (options.onStream) {
                        const completionMessage = `\n\n**✅ Command completed successfully**\n`;
                        options.onStream(completionMessage);
                    }
                    
                    // Call completion callback
                    if (options.onStreamComplete) {
                        this.log.info(`📞 Calling onStreamComplete callback`);
                        this.log.debug(`📞 CALLBACK BUFFER SIZE: ${streamBuffer.length} chars`);
                        options.onStreamComplete(streamBuffer);
                    }
                    
                    const result = { 
                        success: true, 
                        method: 'streaming', 
                        message: 'Command executed via Claude streaming mode',
                        output: streamBuffer
                    };
                    
                    this.log.info(`🎯 RESOLVING WITH SUCCESS: ${JSON.stringify(result, null, 2)}`);
                    resolve(result);
                } else {
                    this.log.error(`❌ Claude process exited with code ${code}`);
                    this.log.error(`❌ ERROR DETAILS:`);
                    this.log.error(`   Exit Code: ${code}`);
                    this.log.error(`   Buffer Size: ${streamBuffer.length} chars`);
                    this.log.error(`   Processed Lines: ${processedLines}`);
                    
                    // Send error message to stream
                    if (options.onStream) {
                        const errorMessage = `\n\n**❌ Command failed with exit code ${code}**\n`;
                        options.onStream(errorMessage);
                    }
                    
                    const result = { 
                        success: false, 
                        error: `Process exited with code ${code}`,
                        message: `Claude execution failed with exit code ${code}`,
                        output: streamBuffer,
                        debug: {
                            exitCode: code,
                            bufferSize: streamBuffer.length,
                            processedLines: processedLines
                        }
                    };
                    
                    this.log.error(`🎯 RESOLVING WITH ERROR: ${JSON.stringify(result, null, 2)}`);
                    resolve(result);
                }
            });
            
            // Handle process errors
            childProcess.on('error', (error) => {
                this.log.error(`💥 Process error: ${error.message}`);
                resolve({ 
                    success: false, 
                    error: error.message,
                    message: `Claude process error: ${error.message}`
                });
            });
        });
    }
    
    // Automatically handle Claude confirmation dialogs
    async handleConfirmations() {
        const maxAttempts = 8;
        let attempts = 0;
        
        while (attempts < maxAttempts) {
            attempts++;
            
            // Wait for Claude processing
            await new Promise(resolve => setTimeout(resolve, 1500));
            
            // Get current screen content
            const capture = await this.getCaptureOutput();
            
            if (!capture.success) {
                break;
            }
            
            const output = capture.output;
            this.log.debug(`Confirmation check ${attempts}: ${output.slice(-200).replace(/\n/g, ' ')}`);
            
            // Check for multi-option confirmation dialog (priority handling)
            if (output.includes('Do you want to proceed?') && 
                (output.includes('1. Yes') || output.includes('2. Yes, and don\'t ask again'))) {
                
                this.log.info(`Detected multi-option confirmation, selecting option 2 (attempt ${attempts})`);
                
                // Select "2. Yes, and don't ask again" to avoid future confirmation dialogs
                await new Promise((resolve) => {
                    exec(`tmux send-keys -t ${this.sessionName} '2'`, (error) => {
                        if (error) {
                            this.log.warn('Failed to send option 2');
                        } else {
                            this.log.info('Auto-confirmation sent (option 2)');
                            // Send Enter key
                            setTimeout(() => {
                                exec(`tmux send-keys -t ${this.sessionName} 'Enter'`, (enterError) => {
                                    if (enterError) {
                                        this.log.warn('Failed to send Enter after option 2');
                                    } else {
                                        this.log.info('Enter sent after option 2 - no future dialogs');
                                    }
                                    resolve();
                                });
                            }, 300);
                        }
                    });
                });
                
                // Wait for confirmation to take effect
                await new Promise(resolve => setTimeout(resolve, 2000));
                continue;
            }
            
            // Check for single option confirmation
            if (output.includes('❯ 1. Yes') || output.includes('▷ 1. Yes')) {
                this.log.info(`Detected single option confirmation, selecting option 1 (attempt ${attempts})`);
                
                await new Promise((resolve) => {
                    exec(`tmux send-keys -t ${this.sessionName} '1'`, (error) => {
                        if (error) {
                            this.log.warn('Failed to send option 1');
                        } else {
                            this.log.info('Auto-confirmation sent (option 1)');
                            // Send Enter key
                            setTimeout(() => {
                                exec(`tmux send-keys -t ${this.sessionName} 'Enter'`, (enterError) => {
                                    if (enterError) {
                                        this.log.warn('Failed to send Enter after option 1');
                                    } else {
                                        this.log.info('Enter sent after option 1');
                                    }
                                    resolve();
                                });
                            }, 300);
                        }
                    });
                });
                
                continue;
            }
            
            // Check for simple Y/N confirmation
            if (output.includes('(y/n)') || output.includes('[Y/n]') || output.includes('[y/N]')) {
                this.log.info(`Detected y/n prompt, sending 'y' (attempt ${attempts})`);
                
                await new Promise((resolve) => {
                    exec(`tmux send-keys -t ${this.sessionName} 'y'`, (error) => {
                        if (error) {
                            this.log.warn('Failed to send y');
                        } else {
                            this.log.info('Auto-confirmation sent (y)');
                            // Send Enter key
                            setTimeout(() => {
                                exec(`tmux send-keys -t ${this.sessionName} 'Enter'`, (enterError) => {
                                    if (enterError) {
                                        this.log.warn('Failed to send Enter after y');
                                    } else {
                                        this.log.info('Enter sent after y');
                                    }
                                    resolve();
                                });
                            }, 300);
                        }
                    });
                });
                
                continue;
            }
            
            // Check for press Enter to continue prompts
            if (output.includes('Press Enter to continue') || 
                output.includes('Enter to confirm') || 
                output.includes('Press Enter')) {
                this.log.info(`Detected Enter prompt, sending Enter (attempt ${attempts})`);
                
                await new Promise((resolve) => {
                    exec(`tmux send-keys -t ${this.sessionName} 'Enter'`, (error) => {
                        if (error) {
                            this.log.warn('Failed to send Enter');
                        } else {
                            this.log.info('Auto-Enter sent');
                        }
                        resolve();
                    });
                });
                
                continue;
            }
            
            // Check if command is currently executing
            if (output.includes('Clauding…') || 
                output.includes('Waiting…') || 
                output.includes('Processing…') ||
                output.includes('Working…')) {
                this.log.info('Command appears to be executing, waiting...');
                continue;
            }
            
            // Check for new empty input box (indicates completion)
            if ((output.includes('│ >') || output.includes('> ')) && 
                !output.includes('Do you want to proceed?') &&
                !output.includes('1. Yes') &&
                !output.includes('(y/n)')) {
                this.log.debug('New input prompt detected, command likely completed');
                break;
            }
            
            // Check for error messages
            if (output.includes('Error:') || output.includes('error:') || output.includes('failed')) {
                this.log.warn('Detected error in output, stopping confirmation attempts');
                break;
            }
            
            // If nothing detected, wait longer before checking again
            if (attempts < maxAttempts) {
                this.log.info('No confirmation prompts detected, waiting longer...');
                await new Promise(resolve => setTimeout(resolve, 2000));
            }
        }
        
        this.log.info(`Confirmation handling completed after ${attempts} attempts`);
        
        // Final state check
        const finalCapture = await this.getCaptureOutput();
        if (finalCapture.success) {
            this.log.debug(`Final state: ${finalCapture.output.slice(-100).replace(/\n/g, ' ')}`);
        }
    }
    
    // Get tmux session output
    async getCaptureOutput() {
        return new Promise((resolve) => {
            const command = `tmux capture-pane -t ${this.sessionName} -p`;
            
            exec(command, (error, stdout, stderr) => {
                if (error) {
                    resolve({ success: false, error: error.message });
                } else {
                    resolve({ success: true, output: stdout });
                }
            });
        });
    }
    
    // Restart Claude session
    async restartClaudeSession() {
        return new Promise(async (resolve) => {
            this.log.info('Restarting Claude tmux session...');
            
            // Kill existing session
            exec(`tmux kill-session -t ${this.sessionName} 2>/dev/null`, async () => {
                // Wait a moment
                await new Promise(r => setTimeout(r, 1000));
                
                // Create new session
                const result = await this.createClaudeSession();
                resolve(result);
            });
        });
    }
    
    // Complete command injection workflow
    async injectCommandFull(token, command) {
        try {
            this.log.debug(`Starting tmux command injection (Token: ${token})`);
            
            // 1. Check if tmux is available
            const tmuxAvailable = await this.checkTmuxAvailable();
            if (!tmuxAvailable) {
                return { success: false, error: 'tmux_not_installed', message: 'Need to install tmux: brew install tmux' };
            }
            
            // 2. Check if Claude session exists
            const sessionExists = await this.checkClaudeSession();
            
            if (!sessionExists) {
                this.log.warn('Claude tmux session not found, creating new session...');
                const createResult = await this.createClaudeSession();
                
                if (!createResult.success) {
                    return { success: false, error: 'session_creation_failed', message: createResult.error };
                }
            }
            
            // 3. Inject command
            const injectResult = await this.injectCommand(this.sessionName, command);
            
            if (injectResult.success) {
                // 4. Send success notification
                await this.sendSuccessNotification(command);
                
                return { 
                    success: true, 
                    message: 'Command successfully injected into Claude tmux session',
                    session: this.sessionName 
                };
            } else {
                return { 
                    success: false, 
                    error: 'injection_failed', 
                    message: injectResult.error 
                };
            }
            
        } catch (error) {
            this.log.error(`Tmux injection error: ${error.message}`);
            return { success: false, error: 'unexpected_error', message: error.message };
        }
    }
    
    // Send success notification
    async sendSuccessNotification(command) {
        const shortCommand = command.length > 30 ? command.substring(0, 30) + '...' : command;
        const notificationScript = `
            display notification "🎉 Command automatically injected into Claude! No manual operation needed" with title "TaskPing Remote Control Success" subtitle "${shortCommand.replace(/"/g, '\\"')}" sound name "Glass"
        `;
        
        exec(`osascript -e '${notificationScript}'`, (error) => {
            if (error) {
                this.log.warn('Failed to send success notification');
            } else {
                this.log.info('Success notification sent');
            }
        });
    }
    
    // Record injection log
    // Helper method to determine if a line should be filtered out
    _shouldFilterLine(line) {
        return line.startsWith('Executing:') || 
               line.includes('PS>') ||
               (line.match(/^\[.*\]$/) && line.includes('System.Text')) || // 只过滤System.Text相关的系统消息
               line.match(/^& /) || // 过滤 PowerShell & 操作符
               line.length === 0 ||
               line === 'powershell' ||
               line === 'PS>' ||
               line.includes('Warning:') && line.includes('DeprecationWarning:') ||
               line.includes('(node:') ||
               line.startsWith('Starting Claude in interactive mode') ||
               line.includes('Script location:') ||
               line.includes('Working directory:') ||
               line.includes('Environment check:') ||
               line.includes('ANTHROPIC_API_KEY:') ||
               line.includes('ANTHROPIC_BASE_URL:') ||
               line.includes('Using claude path:');
    }

    logInjection(command) {
        const logEntry = {
            timestamp: new Date().toISOString(),
            command: command,
            session: this.sessionName,
            pid: process.pid
        };
        
        const logLine = JSON.stringify(logEntry) + '\n';
        
        try {
            fs.appendFileSync(this.logFile, logLine);
        } catch (error) {
            this.log.warn(`Failed to write injection log: ${error.message}`);
        }
    }
    
    // Get session status information
    async getSessionInfo() {
        return new Promise((resolve) => {
            const command = `tmux list-sessions | grep ${this.sessionName}`;
            
            exec(command, (error, stdout, stderr) => {
                if (error) {
                    resolve({ exists: false });
                } else {
                    const sessionInfo = stdout.trim();
                    resolve({ 
                        exists: true, 
                        info: sessionInfo,
                        name: this.sessionName
                    });
                }
            });
        });
    }

    /**
     * Method 1: Execute using child_process.exec with streaming
     */
    async _executeWithExec(originalCommand, options) {
        return new Promise(async (resolve, reject) => {
            this.log.info(`📝 METHOD 1: EXEC WITH STREAMING`);
            
            const { exec } = require('child_process');
            const claudePath = process.env.CLAUDE_CLI_PATH || await this.detectClaudePath();
            const fullCommand = `${claudePath} "${originalCommand}" -p --output-format stream-json --verbose ${options.sessionId ? '--session-id ' + options.sessionId : ''}`;
            
            this.log.info(`🔧 EXEC Command: ${fullCommand}`);
            
            const childProcess = exec(fullCommand, {
                encoding: 'utf8',
                maxBuffer: 1024 * 1024 * 10, // 10MB buffer
                timeout: 300000, // 5 minutes timeout
                env: {
                    ...process.env,
                    PYTHONIOENCODING: 'utf-8',
                    NODE_ENV: 'production'
                }
            });
            
            let streamBuffer = '';
            let processedLines = 0;
            
            childProcess.stdout.on('data', (data) => {
                const chunk = data.toString('utf8');
                this.log.info(`📥 EXEC STDOUT CHUNK (${chunk.length} chars): ${chunk.substring(0, 200)}...`);
                
                streamBuffer += chunk;
                const lines = streamBuffer.split('\n');
                streamBuffer = lines.pop() || '';
                
                for (let i = processedLines; i < lines.length; i++) {
                    const trimmedLine = lines[i].trim();
                    if (trimmedLine && !this._shouldFilterLine(trimmedLine)) {
                        this._processStreamLine(trimmedLine, options.onStream);
                    }
                }
                processedLines = lines.length;
            });
            
            childProcess.stderr.on('data', (data) => {
                const chunk = data.toString('utf8');
                this.log.warn(`⚠️  EXEC STDERR CHUNK (${chunk.length} chars): ${chunk.substring(0, 200)}...`);
                
                // Try to process stderr as well
                streamBuffer += chunk;
                const lines = streamBuffer.split('\n');
                streamBuffer = lines.pop() || '';
                
                for (let i = processedLines; i < lines.length; i++) {
                    const trimmedLine = lines[i].trim();
                    if (trimmedLine && !this._shouldFilterLine(trimmedLine)) {
                        this._processStreamLine(trimmedLine, options.onStream);
                    }
                }
                processedLines = lines.length;
            });
            
            childProcess.on('exit', (code, signal) => {
                this.log.info(`🏁 EXEC PROCESS EXITED: code=${code}, signal=${signal}`);
                
                // Process remaining buffer
                if (streamBuffer.trim()) {
                    this.log.info(`🔄 Processing remaining buffer: ${streamBuffer.substring(0, 100)}...`);
                    if (!this._shouldFilterLine(streamBuffer.trim())) {
                        this._processStreamLine(streamBuffer.trim(), options.onStream);
                    }
                }
                
                if (code === 0) {
                    resolve();
                } else {
                    reject(new Error(`EXEC process exited with code ${code}`));
                }
            });
            
            childProcess.on('error', (error) => {
                this.log.error(`❌ EXEC PROCESS ERROR: ${error.message}`);
                reject(error);
            });
        });
    }

    /**
     * Method 2: Direct spawn with optimized settings
     */
    async _executeWithDirectSpawn(originalCommand, options) {
        return new Promise(async (resolve, reject) => {
            this.log.info(`📝 METHOD 2: DIRECT SPAWN`);
            
            const { spawn } = require('child_process');
            const claudePath = process.env.CLAUDE_CLI_PATH || await this.detectClaudePath();
            const args = [originalCommand, '-p', '--output-format', 'stream-json', '--verbose'];
            
            if (options.sessionId) {
                args.push('--session-id', options.sessionId);
            }
            
            this.log.info(`🔧 Direct spawn command: ${claudePath}`);
            this.log.info(`🔧 Direct spawn args: ${JSON.stringify(args)}`);
            
            const childProcess = spawn(claudePath, args, {
                cwd: process.cwd(),
                env: {
                    ...process.env,
                    PYTHONIOENCODING: 'utf-8',
                    NODE_ENV: 'production'
                },
                encoding: 'utf8',
                stdio: ['pipe', 'pipe', 'pipe']
            });
            
            let streamBuffer = '';
            let processedLines = 0;
            
            childProcess.stdout.on('data', (data) => {
                const chunk = data.toString('utf8');
                this.log.info(`📥 DIRECT SPAWN STDOUT (${chunk.length} chars): ${chunk.substring(0, 200)}...`);
                
                streamBuffer += chunk;
                const lines = streamBuffer.split('\n');
                streamBuffer = lines.pop() || '';
                
                for (let i = processedLines; i < lines.length; i++) {
                    const trimmedLine = lines[i].trim();
                    if (trimmedLine && !this._shouldFilterLine(trimmedLine)) {
                        this._processStreamLine(trimmedLine, options.onStream);
                    }
                }
                processedLines = lines.length;
            });
            
            childProcess.stderr.on('data', (data) => {
                const chunk = data.toString('utf8');
                this.log.warn(`⚠️  DIRECT SPAWN STDERR (${chunk.length} chars): ${chunk.substring(0, 200)}...`);
                
                // Process stderr as well
                streamBuffer += chunk;
                const lines = streamBuffer.split('\n');
                streamBuffer = lines.pop() || '';
                
                for (let i = processedLines; i < lines.length; i++) {
                    const trimmedLine = lines[i].trim();
                    if (trimmedLine && !this._shouldFilterLine(trimmedLine)) {
                        this._processStreamLine(trimmedLine, options.onStream);
                    }
                }
                processedLines = lines.length;
            });
            
            childProcess.on('exit', (code, signal) => {
                this.log.info(`🏁 DIRECT SPAWN EXITED: code=${code}, signal=${signal}`);
                
                // Process remaining buffer
                if (streamBuffer.trim()) {
                    this.log.info(`🔄 Processing remaining buffer: ${streamBuffer.substring(0, 100)}...`);
                    if (!this._shouldFilterLine(streamBuffer.trim())) {
                        this._processStreamLine(streamBuffer.trim(), options.onStream);
                    }
                }
                
                if (code === 0) {
                    resolve();
                } else {
                    reject(new Error(`Direct spawn process exited with code ${code}`));
                }
            });
            
            childProcess.on('error', (error) => {
                this.log.error(`❌ DIRECT SPAWN ERROR: ${error.message}`);
                reject(error);
            });
        });
    }

    /**
     * Method 3: PowerShell command execution
     */
    async _executeWithPowerShellCommand(originalCommand, options) {
        return new Promise(async (resolve, reject) => {
            this.log.info(`📝 METHOD 3: POWERSHELL COMMAND`);
            
            const { exec } = require('child_process');
            const claudePath = process.env.CLAUDE_CLI_PATH || await this.detectClaudePath();
            const utf8Setup = '[Console]::InputEncoding = [Console]::OutputEncoding = New-Object System.Text.UTF8Encoding; ';
            const psCommand = `& '${claudePath}' '${originalCommand}' -p --output-format stream-json --verbose ${options.sessionId ? '--session-id ' + options.sessionId : ''}`;
            const fullCommand = `powershell -NoProfile -ExecutionPolicy Bypass -Command "${utf8Setup}${psCommand}"`;
            
            this.log.info(`🔧 PowerShell command: ${fullCommand}`);
            
            const childProcess = exec(fullCommand, {
                encoding: 'utf8',
                maxBuffer: 1024 * 1024 * 10,
                timeout: 300000,
                env: {
                    ...process.env,
                    PYTHONIOENCODING: 'utf-8',
                    NODE_ENV: 'production'
                }
            });
            
            let streamBuffer = '';
            let processedLines = 0;
            
            childProcess.stdout.on('data', (data) => {
                const chunk = data.toString('utf8');
                this.log.info(`📥 PWSH STDOUT (${chunk.length} chars): ${chunk.substring(0, 200)}...`);
                
                streamBuffer += chunk;
                const lines = streamBuffer.split('\n');
                streamBuffer = lines.pop() || '';
                
                for (let i = processedLines; i < lines.length; i++) {
                    const trimmedLine = lines[i].trim();
                    if (trimmedLine && !this._shouldFilterLine(trimmedLine)) {
                        this._processStreamLine(trimmedLine, options.onStream);
                    }
                }
                processedLines = lines.length;
            });
            
            childProcess.stderr.on('data', (data) => {
                const chunk = data.toString('utf8');
                this.log.warn(`⚠️  PWSH STDERR (${chunk.length} chars): ${chunk.substring(0, 200)}...`);
                
                streamBuffer += chunk;
                const lines = streamBuffer.split('\n');
                streamBuffer = lines.pop() || '';
                
                for (let i = processedLines; i < lines.length; i++) {
                    const trimmedLine = lines[i].trim();
                    if (trimmedLine && !this._shouldFilterLine(trimmedLine)) {
                        this._processStreamLine(trimmedLine, options.onStream);
                    }
                }
                processedLines = lines.length;
            });
            
            childProcess.on('exit', (code, signal) => {
                this.log.info(`🏁 PWSH EXITED: code=${code}, signal=${signal}`);
                
                // Process remaining buffer
                if (streamBuffer.trim()) {
                    this.log.info(`🔄 Processing remaining buffer: ${streamBuffer.substring(0, 100)}...`);
                    if (!this._shouldFilterLine(streamBuffer.trim())) {
                        this._processStreamLine(streamBuffer.trim(), options.onStream);
                    }
                }
                
                if (code === 0) {
                    resolve();
                } else {
                    reject(new Error(`PowerShell process exited with code ${code}`));
                }
            });
            
            childProcess.on('error', (error) => {
                this.log.error(`❌ PWSH ERROR: ${error.message}`);
                reject(error);
            });
        });
    }

    /**
     * Process a single line from the stream
     */
    _processStreamLine(line, callback) {
        this.log.info(`🔍 Processing line: "${line.substring(0, 100)}..."`);
        
        // Try to parse as JSON first
        if (line.startsWith('{') || line.startsWith('[')) {
            try {
                const parsed = JSON.parse(line);
                this.log.info(`✅ JSON parsed successfully, type: ${parsed.type}`);
                this.log.debug(`📋 PARSED OBJECT: ${JSON.stringify(parsed, null, 2)}`);
                
                // Handle different message types
                if (parsed.type === 'assistant' && parsed.message && parsed.message.content) {
                    this.log.info(`🤖 Assistant message found with ${parsed.message.content.length} content items`);
                    
                    // Extract text content from Claude response
                    for (const contentItem of parsed.message.content) {
                        if (contentItem.type === 'text' && contentItem.text) {
                            const text = contentItem.text;
                            this.log.info(`📝 Found text content (${text.length} chars): ${text.substring(0, 100)}...`);
                            
                            if (text.trim()) {
                                this.currentMessage += text;
                                this.hasStreamingContent = true;
                                
                                // Send streaming update
                                if (callback) {
                                    try {
                                        callback({
                                            type: 'stream',
                                            content: text,
                                            timestamp: new Date().toISOString()
                                        });
                                    } catch (callbackError) {
                                        this.log.error(`❌ Callback error: ${callbackError.message}`);
                                    }
                                }
                            }
                        }
                    }
                } else if (parsed.type === 'status') {
                    this.log.info(`📊 Status update: ${parsed.state || 'unknown'}`);
                } else if (parsed.type === 'error') {
                    this.log.error(`❌ Error from Claude: ${parsed.message || 'Unknown error'}`);
                } else {
                    this.log.debug(`🔄 Other message type: ${parsed.type}`);
                }
                
                return true;
            } catch (parseError) {
                this.log.warn(`⚠️  JSON parse failed: ${parseError.message}`);
                this.log.debug(`🔍 Failed JSON: "${line}"`);
                
                // Fall back to treating as plain text
                if (line.trim()) {
                    this.currentMessage += line + '\n';
                    this.hasStreamingContent = true;
                    
                    if (callback) {
                        try {
                            callback({
                                type: 'stream',
                                content: line + '\n',
                                timestamp: new Date().toISOString()
                            });
                        } catch (callbackError) {
                            this.log.error(`❌ Callback error: ${callbackError.message}`);
                        }
                    }
                }
            }
        } else {
            // Treat as plain text
            if (line.trim()) {
                this.log.info(`📝 Plain text content: "${line.substring(0, 100)}..."`);
                this.currentMessage += line + '\n';
                this.hasStreamingContent = true;
                
                if (callback) {
                    try {
                        callback({
                            type: 'stream',
                            content: line + '\n',
                            timestamp: new Date().toISOString()
                        });
                    } catch (callbackError) {
                        this.log.error(`❌ Callback error: ${callbackError.message}`);
                    }
                }
            }
        }
        
        return false;
    }
}

module.exports = TmuxInjector;