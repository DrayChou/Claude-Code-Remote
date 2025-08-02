/**
 * Claude Headless Executor
 * 统一的Claude无头模式执行器，支持Email和Telegram渠道
 * 根据操作系统使用相应的调用方式
 */

const { exec, spawn } = require('child_process');
const path = require('path');
const os = require('os');
const Logger = require('../core/logger');

class ClaudeHeadlessExecutor {
    constructor(logger) {
        this.logger = logger || new Logger('ClaudeHeadless');
        this.platform = os.platform();
        this.isWindows = this.platform === 'win32';
        this.claudePath = process.env.CLAUDE_CLI_PATH || 'claude';
        
        // 确保路径正确处理 - 如果是PowerShell脚本，添加.ps1扩展名
        if (this.isWindows && this.claudePath.endsWith('.ps1')) {
            this.logger.debug(`Using PowerShell script: ${this.claudePath}`);
        } else if (this.isWindows && !this.claudePath.endsWith('.exe') && !this.claudePath.endsWith('.ps1')) {
            // Windows上尝试查找实际的执行文件
            try {
                require('child_process').execSync(`where ${this.claudePath}`, { encoding: 'utf8' });
                this.logger.debug(`Found command in PATH: ${this.claudePath}`);
            } catch (e) {
                this.logger.debug(`Command not found in PATH: ${this.claudePath}`);
            }
        }
        
        this.logger.debug(`Platform: ${this.platform}, Windows: ${this.isWindows}`);
        this.logger.debug(`Claude path: ${this.claudePath}`);
    }

    /**
     * 执行Claude命令（统一接口）
     * @param {string} command - 用户命令
     * @param {Object} options - 执行选项
     * @returns {Promise<Object>} 执行结果
     */
    async executeCommand(command, options = {}) {
        try {
            this.logger.info(`Executing Claude command via headless mode (platform: ${this.platform}, isWindows: ${this.isWindows})`);
            
            // 根据平台选择执行方式
            if (this.isWindows) {
                // Windows使用PowerShell方法
                this.logger.info('Routing to Windows execution method');
                return await this._executeWindowsCommand(command, options);
            } else {
                // Linux/Mac使用传统方法
                this.logger.info('Routing to Unix execution method');
                return await this._executeUnixCommand(command, options);
            }
            
        } catch (error) {
            this.logger.error(`Claude execution failed: ${error.message}`);
            return { 
                success: false, 
                error: error.message,
                message: `Claude execution failed: ${error.message}`
            };
        }
    }

    /**
     * Windows执行方法 - 使用PowerShell spawn调用Claude CLI
     */
    async _executeWindowsCommand(command, options = {}) {
        this.logger.info('Using Windows PowerShell Claude CLI execution method (spawn)');
        this.logger.info(`Command: ${command}`);
        
        // 构建PowerShell参数 - 使用spawn更安全
        // 如果是PowerShell脚本，使用 -File，否则使用 -Command
        let psArgs;
        if (this.claudePath.endsWith('.ps1')) {
            // 对于 .ps1 文件，命令参数需要作为脚本的参数传递
            psArgs = [
                '-NoProfile',
                '-ExecutionPolicy', 'Bypass',
                '-File', this.claudePath,
                command,  // 用户命令作为第一个参数
                '-p',     // Claude CLI 参数
                '--output-format', 'stream-json',
                '--verbose'
            ];
        } else {
            // 对于普通可执行文件，使用 -Command 方式
            const claudeCommand = `& '${this.claudePath}' '${command.replace(/'/g, "''")}' -p --output-format stream-json --verbose`;
            psArgs = [
                '-NoProfile',
                '-ExecutionPolicy', 'Bypass',
                '-Command',
                `[Console]::InputEncoding = [Console]::OutputEncoding = New-Object System.Text.UTF8Encoding; ${claudeCommand}`
            ];
        }
        
        this.logger.info(`PowerShell args: ${JSON.stringify(psArgs)}`);
        
        return new Promise((resolve) => {
            const startTime = Date.now();
            
            this.logger.debug(`Starting PowerShell process with args: ${JSON.stringify(psArgs)}`);
            
            const ps = spawn('powershell.exe', psArgs, {
                cwd: process.cwd(),
                env: {
                    ...process.env
                },
                stdio: ['ignore', 'pipe', 'pipe'],  // 忽略 stdin，只监听 stdout 和 stderr
                encoding: 'utf8'
            });
            
            this.logger.debug(`PowerShell process started with PID: ${ps.pid}`);
            
            // 立即触发一个测试事件，确保监听器工作正常
            setTimeout(() => {
                this.logger.debug(`PowerShell process status check - PID: ${ps.pid}, killed: ${ps.killed}`);
            }, 1000);
            
            let stdout = '';
            let stderr = '';
            let hasError = false;
            
            // 监听标准输出
            ps.stdout.on('data', (data) => {
                const chunk = data.toString('utf8');
                this.logger.debug(`PowerShell stdout chunk (${chunk.length} chars): ${chunk.substring(0, 100)}...`);
                this.logger.info(`PowerShell stdout content: ${chunk}`);
                stdout += chunk;
                
                // 实时流式处理（如果需要）
                if (options.onStream) {
                    options.onStream({
                        type: 'stdout',
                        content: chunk,
                        timestamp: new Date().toISOString()
                    });
                }
            });
            
            // 监听标准错误
            ps.stderr.on('data', (data) => {
                const chunk = data.toString('utf8');
                stderr += chunk;
                
                this.logger.debug(`PowerShell stderr chunk (${chunk.length} chars): ${chunk.substring(0, 100)}...`);
                this.logger.info(`PowerShell stderr content: ${chunk}`);
                
                // 检查认证错误
                if (chunk.includes('Invalid API key') || chunk.includes('Please run /login')) {
                    hasError = true;
                    resolve({
                        success: false,
                        error: 'authentication_required',
                        message: 'Claude authentication required. Please run: claude --login',
                        method: 'windows-powershell-spawn'
                    });
                }
            });
            
            // 监听进程错误
            ps.on('error', (error) => {
                if (hasError) return; // 已经处理过错误
                
                const duration = Date.now() - startTime;
                this.logger.error(`PowerShell process error: ${error.message}`);
                this.logger.error(`Error code: ${error.code}, errno: ${error.errno}`);
                
                resolve({
                    success: false,
                    error: error.message,
                    exitCode: -1,
                    duration: duration,
                    timestamp: new Date().toISOString(),
                    method: 'windows-powershell-spawn-error',
                    stderr: stderr,
                    stdout: stdout
                });
            });
            
            
            // 设置超时 - 缩短超时时间并改进处理
            const timeout = options.timeout || 45000; // 45秒默认超时
            let resolved = false;
            
            const timeoutId = setTimeout(() => {
                if (!resolved && !ps.killed) {
                    this.logger.warn('PowerShell process timeout - completing with partial results');
                    this.logger.warn(`Timeout - accumulated stdout (${stdout.length} chars): ${stdout.substring(0, 200)}...`);
                    this.logger.warn(`Timeout - accumulated stderr (${stderr.length} chars): ${stderr.substring(0, 200)}...`);
                    resolved = true;
                    
                    // 先尝试正常完成
                    const duration = Date.now() - startTime;
                    const assistantResponse = this._extractResponseFromOutput(stdout);
                    this.logger.warn(`Timeout - extracted assistant response (${assistantResponse.length} chars): ${assistantResponse.substring(0, 200)}...`);
                    
                    resolve({
                        success: true,
                        exitCode: -2,
                        assistantResponse: assistantResponse,
                        rawOutput: stdout,
                        stderr: stderr,
                        duration: duration,
                        timestamp: new Date().toISOString(),
                        method: 'windows-powershell-spawn-timeout'
                    });
                    
                    // 然后杀死进程
                    try {
                        ps.kill('SIGTERM');
                        setTimeout(() => {
                            if (!ps.killed) {
                                ps.kill('SIGKILL');
                            }
                        }, 2000);
                    } catch (err) {
                        this.logger.debug('Error killing process:', err.message);
                    }
                }
            }, timeout);
            
            // 在进程完成时清除超时
            ps.on('close', (code) => {
                clearTimeout(timeoutId);
                if (resolved) return; // 已经通过超时处理了
                resolved = true;
                
                const duration = Date.now() - startTime;
                
                if (code === 0) {
                    this.logger.info(`PowerShell Claude CLI execution completed successfully (spawn)`);
                    this.logger.debug(`Output length: ${stdout.length}, stderr length: ${stderr.length}`);
                    this.logger.info(`Complete stdout content: ${stdout}`);
                    this.logger.info(`Complete stderr content: ${stderr}`);
                    
                    // 提取Claude的响应 - 处理流式JSON格式
                    let assistantResponse = '';
                    if (stdout.trim()) {
                        // 处理流式JSON格式
                        const lines = stdout.split('\n').filter(line => line.trim());
                        
                        for (const line of lines) {
                            try {
                                const json = JSON.parse(line);
                                
                                // 跳过系统消息
                                if (json.type === 'system' && json.subtype === 'init') {
                                    continue;
                                }
                                
                                // 提取助手回复
                                if (json.type === 'assistant' && json.message && json.message.content) {
                                    const textContent = json.message.content.find(c => c.type === 'text');
                                    if (textContent && textContent.text) {
                                        assistantResponse = textContent.text;
                                        break; // 找到回复后就停止
                                    }
                                }
                                
                                // 从结果中提取回复
                                if (json.type === 'result' && json.subtype === 'success' && json.result) {
                                    if (!assistantResponse) { // 如果还没有找到回复，使用结果
                                        assistantResponse = json.result;
                                    }
                                }
                            } catch (e) {
                                // 如果不是JSON格式，跳过
                                continue;
                            }
                        }
                        
                        // 如果没有找到JSON格式的回复，使用备用解析方法
                        if (!assistantResponse) {
                            const responseLines = [];
                            let foundResponse = false;
                            
                            for (const line of lines) {
                                // 跳过系统消息和Node.js警告
                                if (line.includes('Executing:') || 
                                    line.includes('Node.js') || 
                                    line.includes('DEP0190') ||
                                    line.includes('DeprecationWarning') ||
                                    line.trim() === 'Tests passed successfully!') {
                                    continue;
                                }
                                
                                // 一旦找到非系统消息，就包含所有后续内容
                                if (!foundResponse && line.trim()) {
                                    foundResponse = true;
                                }
                                
                                if (foundResponse) {
                                    responseLines.push(line);
                                }
                            }
                            
                            assistantResponse = responseLines.join('\n').trim();
                        }
                    }
                    
                    // 如果没有找到助手回复，使用提取方法
                    if (!assistantResponse) {
                        assistantResponse = this._extractResponseFromOutput(stdout);
                    }
                    
                    this.logger.info(`Final assistant response (${assistantResponse.length} chars): ${assistantResponse}`);
                    
                    resolve({
                        success: true,
                        exitCode: 0,
                        assistantResponse: assistantResponse,
                        rawOutput: stdout,
                        stderr: stderr,
                        duration: duration,
                        timestamp: new Date().toISOString(),
                        method: 'windows-powershell-spawn'
                    });
                } else {
                    this.logger.error(`PowerShell Claude CLI execution failed with exit code: ${code}`);
                    this.logger.error(`Complete stderr on failure: ${stderr}`);
                    this.logger.error(`Complete stdout on failure: ${stdout}`);
                    
                    resolve({
                        success: false,
                        error: `Process exited with code ${code}`,
                        exitCode: code,
                        duration: duration,
                        timestamp: new Date().toISOString(),
                        method: 'windows-powershell-spawn-failure',
                        stderr: stderr,
                        stdout: stdout
                    });
                }
            });
        });
    }

    /**
     * 从输出中提取助手回复
     */
    _extractResponseFromOutput(output) {
        if (!output || !output.trim()) {
            return 'Command executed but no response received.';
        }
        
        // 尝试解析JSON流式输出
        const lines = output.split('\n').filter(line => line.trim());
        let assistantResponse = '';
        
        for (const line of lines) {
            try {
                const json = JSON.parse(line);
                
                // 提取助手消息
                if (json.type === 'assistant' && json.message && json.message.content) {
                    const textContent = json.message.content.find(c => c.type === 'text');
                    if (textContent && textContent.text) {
                        assistantResponse += textContent.text;
                    }
                }
                
                // 提取结果消息
                if (json.type === 'result' && json.subtype === 'success' && json.result) {
                    if (!assistantResponse) {
                        assistantResponse = json.result;
                    }
                }
            } catch (e) {
                // 不是JSON，继续处理
                continue;
            }
        }
        
        // 如果没有找到JSON格式的回复，使用文本清理
        if (!assistantResponse) {
            const cleanLines = [];
            let foundContent = false;
            
            for (const line of lines) {
                const cleanLine = line.trim();
                
                // 跳过系统消息
                if (cleanLine.includes('"type":"system"') ||
                    cleanLine.includes('Executing:') ||
                    cleanLine.includes('Node.js') ||
                    cleanLine.includes('DEP0190') ||
                    cleanLine.includes('DeprecationWarning') ||
                    cleanLine.includes('Windows PowerShell') ||
                    cleanLine.includes('版权所有') ||
                    cleanLine.startsWith('Microsoft') ||
                    cleanLine === '') {
                    continue;
                }
                
                // 开始收集内容
                if (!foundContent && cleanLine.length > 0) {
                    foundContent = true;
                }
                
                if (foundContent) {
                    cleanLines.push(cleanLine);
                }
            }
            
            assistantResponse = cleanLines.join('\n').trim();
        }
        
        // 如果仍然没有内容，返回更有用的默认消息
        if (!assistantResponse) {
            if (output.length > 0) {
                // 如果有输出但无法解析，返回原始输出的摘要
                const summary = output.replace(/\s+/g, ' ').trim();
                assistantResponse = summary.length > 200 ? 
                    summary.substring(0, 200) + '...' : 
                    summary || 'Command executed but produced non-text output';
            } else {
                assistantResponse = 'Command executed but no response received';
            }
        }
        
        return assistantResponse;
    }

    /**
     * Unix执行方法 - Linux/Mac
     */
    async _executeUnixCommand(command, options = {}) {
        this.logger.debug('Using Unix execution method');
        
        // 构建Claude命令参数
        const claudeArgs = this._buildClaudeArgs(command, options);
        const fullCommand = `${this.claudePath} ${claudeArgs.join(' ')}`;
        
        this.logger.debug(`Executing: ${fullCommand}`);
        
        // 根据选项决定执行方式
        if (options.streaming && options.onStream) {
            return await this._executeStreamingCommand(fullCommand, options);
        } else {
            return await this._executeNormalCommand(fullCommand, options);
        }
    }

    /**
     * 构建Claude命令参数
     */
    _buildClaudeArgs(command, options) {
        let args = [`"${command.replace(/"/g, '\\"')}"`];
        
        // 基础参数
        if (options.streaming) {
            args.push('-p', '--output-format', 'stream-json');
            this.logger.debug('Using streaming mode');
        } else {
            args.push('-p');
        }
        
        // 模型选择
        if (options.model) {
            args.push('--model', options.model);
        }
        
        // 会话管理
        if (options.sessionId) {
            args.push('--session-id', options.sessionId);
        } else if (options.continue) {
            args.push('--continue');
        } else if (options.resume) {
            args.push('--resume', options.resume);
        }
        
        // 权限模式
        if (options.permissionMode) {
            args.push('--permission-mode', options.permissionMode);
        }
        
        // 工具控制
        if (options.allowedTools && options.allowedTools.length > 0) {
            args.push('--allowedTools', options.allowedTools.join(' '));
        }
        
        if (options.disallowedTools && options.disallowedTools.length > 0) {
            args.push('--disallowedTools', options.disallowedTools.join(' '));
        }
        
        // 调试模式
        if (options.debug) {
            args.push('-d');
        }
        
        // 详细模式
        if (options.verbose) {
            args.push('--verbose');
        }
        
        return args;
    }
    
    /**
     * 执行普通命令（非流式）
     */
    async _executeNormalCommand(fullCommand, options) {
        return new Promise((resolve) => {
            const childProcess = exec(fullCommand, {
                cwd: process.cwd(),
                env: process.env,
                encoding: 'utf8',
                timeout: options.timeout || 300000 // 5分钟默认超时
            }, (error, stdout, stderr) => {
                if (error) {
                    this.logger.error(`Claude execution failed: ${error.message}`);
                    
                    // 检查认证问题
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
                            message: `Claude execution failed: ${error.message}`,
                            stderr: stderr
                        });
                    }
                } else {
                    this.logger.info('Claude command executed successfully');
                    this.logger.debug(`Claude output length: ${stdout.length} characters`);
                    
                    resolve({ 
                        success: true, 
                        method: 'headless', 
                        message: 'Command executed via Claude headless mode',
                        output: stdout,
                        stderr: stderr
                    });
                }
            });
            
            this.logger.debug(`Started Claude process with PID: ${childProcess.pid}`);
            
            // 处理超时
            if (options.onTimeout) {
                setTimeout(() => {
                    if (!childProcess.killed) {
                        options.onTimeout();
                    }
                }, (options.timeout || 300000) - 10000); // 提前10秒警告
            }
        });
    }
    
    /**
     * 执行流式命令
     */
    async _executeStreamingCommand(fullCommand, options) {
        return new Promise((resolve) => {
            // 解析命令用于spawn
            const parts = fullCommand.match(/(?:[^\\s"]+|"[^"]*")+/g);
            const cmd = parts[0];
            const args = parts.slice(1).map(arg => arg.replace(/^"(.*)"$/, '$1'));
            
            const childProcess = spawn(cmd, args, {
                cwd: process.cwd(),
                env: process.env,
                stdio: ['pipe', 'pipe', 'pipe']
            });
            
            let fullOutput = '';
            let hasError = false;
            let streamBuffer = '';
            
            this.logger.debug(`Started streaming Claude process with PID: ${childProcess.pid}`);
            
            // 处理stdout（流式数据）
            childProcess.stdout.on('data', (data) => {
                const chunk = data.toString('utf8');
                fullOutput += chunk;
                streamBuffer += chunk;
                
                // 处理流式JSON数据
                this._processStreamChunk(streamBuffer, options, (processedChunk) => {
                    streamBuffer = processedChunk; // 更新缓冲区
                });
            });
            
            // 处理stderr
            childProcess.stderr.on('data', (data) => {
                const errorText = data.toString('utf8');
                this.logger.warn(`Claude stderr: ${errorText}`);
                
                if (errorText.includes('Invalid API key') || errorText.includes('Please run /login')) {
                    hasError = true;
                    resolve({ 
                        success: false, 
                        error: 'authentication_required',
                        message: 'Claude authentication required. Please run: claude --login'
                    });
                }
            });
            
            // 处理进程完成
            childProcess.on('close', (code) => {
                if (hasError) return; // 已经解决了错误
                
                if (code === 0) {
                    this.logger.info('Streaming Claude command completed successfully');
                    
                    // 最终流完成回调
                    if (options.onStreamComplete) {
                        options.onStreamComplete(fullOutput);
                    }
                    
                    resolve({ 
                        success: true, 
                        method: 'streaming', 
                        message: 'Command executed via Claude streaming mode',
                        output: fullOutput
                    });
                } else {
                    this.logger.error(`Claude process exited with code ${code}`);
                    resolve({ 
                        success: false, 
                        error: `Process exited with code ${code}`,
                        message: `Claude execution failed with exit code ${code}`
                    });
                }
            });
            
            // 处理进程错误
            childProcess.on('error', (error) => {
                if (hasError) return; // 已经解决了错误
                
                this.logger.error(`Claude process error: ${error.message}`);
                resolve({ 
                    success: false, 
                    error: error.message,
                    message: `Claude process error: ${error.message}`
                });
            });
        });
    }
    
    /**
     * 处理流式数据块
     */
    _processStreamChunk(buffer, options, updateBuffer) {
        const lines = buffer.split('\\n');
        const completeLines = lines.slice(0, -1); // 除了最后一行（可能不完整）
        const remainingBuffer = lines[lines.length - 1]; // 保留不完整的行
        
        for (const line of completeLines) {
            if (line.trim()) {
                try {
                    const parsed = JSON.parse(line);
                    if (parsed.type === 'content' && parsed.content) {
                        // 发送流式内容
                        if (options.onStream) {
                            options.onStream(parsed.content);
                        }
                    }
                } catch (parseError) {
                    // 如果不是JSON，作为普通文本处理
                    if (options.onStream) {
                        options.onStream(line + '\\n');
                    }
                }
            }
        }
        
        updateBuffer(remainingBuffer);
    }
    
    /**
     * 获取Claude版本信息
     */
    async getClaudeInfo() {
        try {
            if (this.isWindows) {
                // Windows使用PowerShell获取版本
                const psCommand = `& '${this.claudePath}' --version`;
                const psArgs = [
                    '-NoProfile',
                    '-ExecutionPolicy', 
                    'Bypass',
                    '-Command',
                    `[Console]::InputEncoding = [Console]::OutputEncoding = New-Object System.Text.UTF8Encoding; ${psCommand}`
                ];
                
                const result = await this._executePowerShellCommand(psArgs);
                if (result.success) {
                    return {
                        version: result.output.trim(),
                        path: this.claudePath,
                        platform: 'windows'
                    };
                }
            } else {
                // Unix使用传统方法
                const result = await this._executeNormalCommand(`${this.claudePath} --version`, {});
                if (result.success) {
                    return {
                        version: result.output.trim(),
                        path: this.claudePath,
                        platform: this.platform
                    };
                }
            }
        } catch (error) {
            this.logger.warn('Failed to get Claude version:', error.message);
        }
        
        return {
            version: 'Unknown',
            path: this.claudePath,
            platform: this.platform
        };
    }

    /**
     * 执行PowerShell命令（用于版本检查等）
     */
    async _executePowerShellCommand(psCommand, options = {}) {
        return new Promise((resolve) => {
            const psArgs = [
                '-NoProfile',
                '-ExecutionPolicy', 
                'Bypass',
                '-Command',
                `[Console]::InputEncoding = [Console]::OutputEncoding = New-Object System.Text.UTF8Encoding; ${psCommand}`
            ];
            
            const ps = spawn('powershell.exe', psArgs, {
                cwd: process.cwd(),
                env: process.env,
                encoding: 'utf8',
                stdio: ['pipe', 'pipe', 'pipe'],
                timeout: options.timeout || 30000
            });
            
            let output = '';
            let error = '';
            
            ps.stdout.on('data', (data) => {
                output += data.toString('utf8');
            });
            
            ps.stderr.on('data', (data) => {
                error += data.toString('utf8');
            });
            
            ps.on('close', (code) => {
                resolve({
                    success: code === 0,
                    output: output,
                    error: error,
                    exitCode: code
                });
            });
            
            ps.on('error', (error) => {
                resolve({
                    success: false,
                    output: '',
                    error: error.message,
                    exitCode: -1
                });
            });
        });
    }
}

module.exports = ClaudeHeadlessExecutor;