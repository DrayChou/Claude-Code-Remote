/**
 * Enhanced PowerShell Script Executor
 * Provides robust PowerShell execution with spawn-based approach
 */

const { spawn } = require('child_process');
const path = require('path');
const Logger = require('../core/logger');

class PowerShellExecutor {
    constructor(config = {}) {
        this.logger = new Logger('PowerShellExecutor');
        this.timeout = config.timeout || 30000; // 30 seconds default timeout
    }

    /**
     * Execute a PowerShell script file (.ps1) with arguments
     * @param {string} scriptPath - Path to the .ps1 script
     * @param {string[]} args - Arguments to pass to the script
     * @param {Object} options - Execution options
     * @returns {Promise<Object>} - Execution result
     */
    async executeScript(scriptPath, args = [], options = {}) {
        return new Promise((resolve) => {
            try {
                const psArgs = [
                    '-NoProfile',
                    '-ExecutionPolicy', 'Bypass',
                    '-File', scriptPath,
                    ...args
                ];
                
                const child = spawn('powershell.exe', psArgs, {
                    cwd: options.cwd || process.cwd(),
                    env: { ...process.env },
                    stdio: ['ignore', 'pipe', 'pipe'],
                    encoding: 'utf8'
                });
                
                let stdout = '';
                let stderr = '';
                let timeoutId = null;
                
                // Set up timeout
                if (this.timeout > 0) {
                    timeoutId = setTimeout(() => {
                        this.logger.warn(`PowerShell script timeout: ${scriptPath}`);
                        child.kill('SIGTERM');
                        
                        // Force kill after additional timeout
                        setTimeout(() => {
                            child.kill('SIGKILL');
                        }, 5000);
                    }, this.timeout);
                }
                
                // Monitor stdout
                child.stdout.on('data', (data) => {
                    const chunk = data.toString('utf8');
                    stdout += chunk;
                    
                    // Real-time streaming callback
                    if (options.onStream) {
                        options.onStream({
                            type: 'stdout',
                            content: chunk,
                            timestamp: new Date().toISOString()
                        });
                    }
                });
                
                // Monitor stderr
                child.stderr.on('data', (data) => {
                    const chunk = data.toString('utf8');
                    stderr += chunk;
                    
                    // Real-time streaming callback
                    if (options.onStream) {
                        options.onStream({
                            type: 'stderr',
                            content: chunk,
                            timestamp: new Date().toISOString()
                        });
                    }
                });
                
                child.on('error', (error) => {
                    if (timeoutId) clearTimeout(timeoutId);
                    this.logger.error(`PowerShell script execution error: ${error.message}`);
                    resolve({
                        success: false,
                        error: error.message,
                        stdout: stdout,
                        stderr: stderr
                    });
                });
                
                child.on('close', (code) => {
                    if (timeoutId) clearTimeout(timeoutId);
                    
                    const result = {
                        success: code === 0,
                        exitCode: code,
                        stdout: stdout,
                        stderr: stderr
                    };
                    
                    if (code === 0) {
                        this.logger.info(`PowerShell script executed successfully: ${scriptPath}`);
                    } else {
                        this.logger.error(`PowerShell script failed with exit code ${code}: ${scriptPath}`);
                        if (stderr) {
                            this.logger.error(`Script error: ${stderr}`);
                        }
                    }
                    
                    resolve(result);
                });
                
            } catch (error) {
                this.logger.error(`Failed to spawn PowerShell script: ${error.message}`);
                resolve({
                    success: false,
                    error: error.message,
                    stdout: '',
                    stderr: ''
                });
            }
        });
    }

    /**
     * Execute a PowerShell command directly
     * @param {string} command - PowerShell command to execute
     * @param {Object} options - Execution options
     * @returns {Promise<Object>} - Execution result
     */
    async executeCommand(command, options = {}) {
        return new Promise((resolve) => {
            try {
                const psArgs = [
                    '-NoProfile',
                    '-ExecutionPolicy', 'Bypass',
                    '-Command', command
                ];
                
                const child = spawn('powershell.exe', psArgs, {
                    cwd: options.cwd || process.cwd(),
                    env: { ...process.env },
                    stdio: ['ignore', 'pipe', 'pipe'],
                    encoding: 'utf8'
                });
                
                let stdout = '';
                let stderr = '';
                let timeoutId = null;
                
                // Set up timeout
                if (this.timeout > 0) {
                    timeoutId = setTimeout(() => {
                        this.logger.warn(`PowerShell command timeout: ${command.substring(0, 50)}...`);
                        child.kill('SIGTERM');
                        
                        setTimeout(() => {
                            child.kill('SIGKILL');
                        }, 5000);
                    }, this.timeout);
                }
                
                // Monitor stdout
                child.stdout.on('data', (data) => {
                    const chunk = data.toString('utf8');
                    stdout += chunk;
                    
                    if (options.onStream) {
                        options.onStream({
                            type: 'stdout',
                            content: chunk,
                            timestamp: new Date().toISOString()
                        });
                    }
                });
                
                // Monitor stderr
                child.stderr.on('data', (data) => {
                    const chunk = data.toString('utf8');
                    stderr += chunk;
                    
                    if (options.onStream) {
                        options.onStream({
                            type: 'stderr',
                            content: chunk,
                            timestamp: new Date().toISOString()
                        });
                    }
                });
                
                child.on('error', (error) => {
                    if (timeoutId) clearTimeout(timeoutId);
                    this.logger.error(`PowerShell command execution error: ${error.message}`);
                    resolve({
                        success: false,
                        error: error.message,
                        stdout: stdout,
                        stderr: stderr
                    });
                });
                
                child.on('close', (code) => {
                    if (timeoutId) clearTimeout(timeoutId);
                    
                    const result = {
                        success: code === 0,
                        exitCode: code,
                        stdout: stdout,
                        stderr: stderr
                    };
                    
                    if (code === 0) {
                        this.logger.info(`PowerShell command executed successfully`);
                    } else {
                        this.logger.error(`PowerShell command failed with exit code ${code}`);
                        if (stderr) {
                            this.logger.error(`Command error: ${stderr}`);
                        }
                    }
                    
                    resolve(result);
                });
                
            } catch (error) {
                this.logger.error(`Failed to spawn PowerShell command: ${error.message}`);
                resolve({
                    success: false,
                    error: error.message,
                    stdout: '',
                    stderr: ''
                });
            }
        });
    }

    /**
     * Execute a PowerShell command in a new window
     * @param {string} command - Command to execute
     * @param {Object} options - Execution options
     * @returns {Promise<boolean>} - Success status
     */
    async executeInNewWindow(command, options = {}) {
        return new Promise((resolve) => {
            try {
                // Create a command that opens a new PowerShell window and executes the command
                const windowTitle = options.title || 'Claude Command Execution';
                const psCommand = `Start-Process powershell -ArgumentList '-NoExit', '-WindowTitle', '${windowTitle}', '-Command', '${command.replace(/'/g, "''")}'`;
                
                const child = spawn('powershell', ['-Command', psCommand], {
                    detached: true,
                    stdio: 'ignore'
                });
                
                child.unref();
                
                this.logger.info(`Command executed in new PowerShell window: ${windowTitle}`);
                resolve(true);
                
            } catch (error) {
                this.logger.error(`Failed to execute in new PowerShell window: ${error.message}`);
                resolve(false);
            }
        });
    }

    /**
     * Check if PowerShell is available
     * @returns {Promise<boolean>}
     */
    async isAvailable() {
        return new Promise((resolve) => {
            try {
                const child = spawn('powershell', ['-Command', '$PSVersionTable.PSVersion'], {
                    stdio: ['ignore', 'pipe', 'ignore'],
                    timeout: 5000
                });
                
                child.on('close', (code) => {
                    resolve(code === 0);
                });
                
                child.on('error', () => {
                    resolve(false);
                });
                
            } catch (error) {
                resolve(false);
            }
        });
    }
}

module.exports = PowerShellExecutor;