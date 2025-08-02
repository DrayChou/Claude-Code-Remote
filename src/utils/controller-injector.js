/**
 * Controller Injector
 * Injects commands into tmux sessions or PTY
 */

const { execSync, spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const Logger = require('../core/logger');
const PowerShellExecutor = require('./powershell-executor');

class ControllerInjector {
    constructor(config = {}) {
        this.logger = new Logger('ControllerInjector');
        this.mode = config.mode || process.env.INJECTION_MODE || 'pty';
        this.defaultSession = config.defaultSession || process.env.TMUX_SESSION || 'claude-code';
        this.powerShellExecutor = new PowerShellExecutor(config);
    }

    async injectCommand(command, sessionName = null) {
        const session = sessionName || this.defaultSession;
        
        if (this.mode === 'tmux') {
            return this._injectTmux(command, session);
        } else {
            return this._injectPty(command, session);
        }
    }

    async _injectTmux(command, sessionName) {
        try {
            // Check if tmux is available
            try {
                execSync('tmux -V', { stdio: 'ignore' });
            } catch (error) {
                // tmux not available, try Windows alternative
                this.logger.warn('tmux not available, using Windows command prompt injection');
                return await this._injectWindows(command);
            }

            // Check if tmux session exists
            try {
                execSync(`tmux has-session -t ${sessionName}`, { stdio: 'ignore' });
            } catch (error) {
                this.logger.warn(`Tmux session '${sessionName}' not found, attempting to create it`);
                
                // Try to create the session
                try {
                    execSync(`tmux new-session -d -s ${sessionName}`, { stdio: 'ignore' });
                    this.logger.info(`Created new tmux session: ${sessionName}`);
                } catch (createError) {
                    throw new Error(`Failed to create tmux session '${sessionName}': ${createError.message}`);
                }
            }

            // Send command to tmux session and execute it
            const escapedCommand = command.replace(/'/g, "'\\''");
            
            // Send command first
            execSync(`tmux send-keys -t ${sessionName} '${escapedCommand}'`);
            // Then send Enter as separate command
            execSync(`tmux send-keys -t ${sessionName} Enter`);
            
            this.logger.info(`Command injected to tmux session '${sessionName}'`);
            return true;
        } catch (error) {
            this.logger.error('Failed to inject command via tmux:', error.message);
            
            // Fallback to Windows command prompt
            if (process.platform === 'win32') {
                this.logger.warn('tmux failed, trying Windows fallback');
                return await this._injectWindows(command);
            }
            
            throw error;
        }
    }

    async _injectWindows(command) {
        try {
            const windowsMode = process.env.WINDOWS_INJECTION_MODE || 'auto';
            this.logger.info(`Windows mode: ${windowsMode} - Processing command: ${command}`);
            
            if (windowsMode === 'file-only') {
                return this._saveCommandToFile(command);
            }
            
            // Try different execution methods
            const executionMethods = [
                async () => await this._executeInNewPowerShell(command),
                () => this._executeInCurrentSession(command),
                () => this._executeInWindowsTerminal(command),
                async () => await this._executePowerShellScriptIfExists(command)
            ];
            
            for (const method of executionMethods) {
                try {
                    const result = await method();
                    if (result) {
                        return true;
                    }
                } catch (error) {
                    this.logger.debug(`Execution method failed: ${error.message}`);
                }
            }
            
            // All methods failed, fallback to file
            this.logger.warn('All direct execution methods failed, saving to file');
            return this._saveCommandToFile(command);
            
        } catch (error) {
            this.logger.error('Failed to inject command via Windows method:', error.message);
            throw error;
        }
    }

    async _executeInNewPowerShell(command) {
        try {
            // 针对不同类型的命令使用不同的策略
            if (command.includes('claude') || command.includes('cc')) {
                // Claude CLI 命令 - 在新窗口中执行并保持打开
                const windowTitle = 'Claude Command Execution';
                const psCommand = `Write-Host "Executing Claude command..."; ${command}`;
                
                return await this.powerShellExecutor.executeInNewWindow(psCommand, { title: windowTitle });
            } else {
                // 其他命令 - 简单执行
                const result = await this.powerShellExecutor.executeCommand(command);
                return result.success;
            }
        } catch (error) {
            this.logger.debug(`PowerShell execution failed: ${error.message}`);
            return false;
        }
    }

    _executeInCurrentSession(command) {
        try {
            const { execSync } = require('child_process');
            
            // 对于简单命令，可以同步执行
            if (command.length < 100 && !command.includes('claude')) {
                execSync(command, { stdio: 'ignore', timeout: 5000 });
                this.logger.info('Command executed synchronously');
                return true;
            }
            
            return false;
        } catch (error) {
            this.logger.debug(`Sync execution failed: ${error.message}`);
            return false;
        }
    }

    _executeInWindowsTerminal(command) {
        try {
            const { spawn } = require('child_process');
            
            // 尝试使用 Windows Terminal
            const child = spawn('wt', ['powershell', '-Command', command], {
                detached: true,
                stdio: 'ignore'
            });
            
            child.unref();
            this.logger.info('Command executed in Windows Terminal');
            return true;
        } catch (error) {
            this.logger.debug(`Windows Terminal execution failed: ${error.message}`);
            return false;
        }
    }

    async _executePowerShellScriptIfExists(command) {
        try {
            // Check if the command looks like a PowerShell script path
            if (command.toLowerCase().endsWith('.ps1') || command.includes('.ps1')) {
                // Extract script path and arguments
                const parts = command.split(' ');
                const scriptPath = parts[0];
                const args = parts.slice(1);
                
                // Check if the script file exists
                if (fs.existsSync(scriptPath)) {
                    this.logger.info(`Executing PowerShell script: ${scriptPath}`);
                    const result = await this.powerShellExecutor.executeScript(scriptPath, args);
                    return result.success;
                }
            }
            return false;
        } catch (error) {
            this.logger.debug(`PowerShell script execution check failed: ${error.message}`);
            return false;
        }
    }

    _saveCommandToFile(command) {
        const tempDir = path.join(__dirname, '../data/tmux-captures');
        if (!fs.existsSync(tempDir)) {
            fs.mkdirSync(tempDir, { recursive: true });
        }
        
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const commandFile = path.join(tempDir, `command-${timestamp}.txt`);
        
        const commandContent = `# Command received at ${new Date().toLocaleString()}\n${command}\n\n# To execute this command, copy and paste it into your terminal\n`;
        fs.writeFileSync(commandFile, commandContent, 'utf8');
        
        this.logger.info(`Command saved to file: ${commandFile}`);
        return true;
    }

    _injectPty(command, sessionName) {
        try {
            // Find PTY session file
            const sessionMapPath = process.env.SESSION_MAP_PATH || 
                                   path.join(__dirname, '../data/session-map.json');
            
            if (!fs.existsSync(sessionMapPath)) {
                throw new Error('Session map file not found');
            }

            const sessionMap = JSON.parse(fs.readFileSync(sessionMapPath, 'utf8'));
            
            // First try to find by sessionName (token)
            let sessionInfo = sessionMap[sessionName];
            
            // If not found by token, try to find by tmux session name
            if (!sessionInfo) {
                for (const [token, info] of Object.entries(sessionMap)) {
                    if (info.tmuxSession === sessionName) {
                        sessionInfo = info;
                        break;
                    }
                }
            }
            
            if (!sessionInfo) {
                throw new Error(`PTY session '${sessionName}' not found`);
            }

            // Check if we have a ptyPath
            if (!sessionInfo.ptyPath) {
                // Fallback: try to use tmux if available and sessionName looks like a tmux session
                if (sessionName === 'default' || sessionName.includes('claude')) {
                    this.logger.warn(`PTY path not found for session '${sessionName}', attempting tmux fallback`);
                    return this._injectTmux(command, sessionName);
                } else {
                    throw new Error(`PTY path not configured for session '${sessionName}'`);
                }
            }

            // Validate that ptyPath is not a session file (prevent corruption)
            if (sessionInfo.ptyPath.includes('.json') && 
                (sessionInfo.ptyPath.includes('sessions') || sessionInfo.ptyPath.includes('session-map'))) {
                throw new Error(`Invalid PTY path for session '${sessionName}': Cannot write to session files`);
            }

            // Check if the ptyPath actually exists and is a valid device/file
            if (!fs.existsSync(sessionInfo.ptyPath)) {
                this.logger.warn(`PTY device not found for session '${sessionName}': ${sessionInfo.ptyPath}, attempting tmux fallback`);
                return this._injectTmux(command, sessionInfo.tmuxSession || sessionName);
            }

            // Write command to PTY
            fs.writeFileSync(sessionInfo.ptyPath, command + '\n');
            
            this.logger.info(`Command injected to PTY session '${sessionName}'`);
            return true;
        } catch (error) {
            this.logger.error('Failed to inject command via PTY:', error.message);
            
            // Final fallback: try tmux mode if PTY fails
            if (error.message.includes('PTY') && sessionName) {
                this.logger.warn('PTY injection failed, attempting tmux fallback');
                try {
                    return this._injectTmux(command, sessionName);
                } catch (tmuxError) {
                    // If tmux also fails, throw the original PTY error
                    throw error;
                }
            }
            
            throw error;
        }
    }

    listSessions() {
        if (this.mode === 'tmux') {
            try {
                const output = execSync('tmux list-sessions -F "#{session_name}"', { 
                    encoding: 'utf8',
                    stdio: ['ignore', 'pipe', 'ignore']
                });
                return output.trim().split('\n').filter(Boolean);
            } catch (error) {
                return [];
            }
        } else {
            try {
                const sessionMapPath = process.env.SESSION_MAP_PATH || 
                                       path.join(__dirname, '../data/session-map.json');
                
                if (!fs.existsSync(sessionMapPath)) {
                    return [];
                }

                const sessionMap = JSON.parse(fs.readFileSync(sessionMapPath, 'utf8'));
                return Object.keys(sessionMap);
            } catch (error) {
                return [];
            }
        }
    }
}

module.exports = ControllerInjector;