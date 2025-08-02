#!/usr/bin/env node

/**
 * Windows Direct Execution Method for Telegram Commands
 * This script provides a direct execution method that doesn't require tmux
 * Designed for Windows environments where tmux is not available
 */

const path = require('path');
const fs = require('fs');

// Load environment variables
require('dotenv').config();

console.log('🚀 WINDOWS DIRECT EXECUTION METHOD');
console.log('====================================\n');

class WindowsDirectExecutor {
    constructor() {
        this.claudePath = process.env.CLAUDE_CLI_PATH || 'C:\\Users\\dray\\scoop\\shims\\cc.tuzi.ps1';
        this.workingDir = process.cwd();
        this.proxyUrl = process.env.HTTP_PROXY || null;
        
        console.log(`📋 Configuration:`);
        console.log(`   Claude Path: ${this.claudePath}`);
        console.log(`   Working Dir: ${this.workingDir}`);
        console.log(`   Proxy: ${this.proxyUrl || 'None'}`);
        console.log(`   Platform: ${process.platform}`);
        console.log('');
    }

    /**
     * Execute Claude command directly without tmux
     */
    async executeCommand(command, options = {}) {
        console.log(`🚀 Executing command: ${command}`);
        
        const { spawn } = require('child_process');
        const sessionId = options.sessionId || this.generateSessionId();
        
        // Build PowerShell command
        const utf8Setup = '[Console]::InputEncoding = [Console]::OutputEncoding = New-Object System.Text.UTF8Encoding; ';
        const psCommand = `& '${this.claudePath}' '${command}' -p --output-format stream-json --verbose`;
        if (sessionId) {
            psCommand += ` --session-id ${sessionId}`;
        }
        
        console.log(`🔧 PowerShell command: ${psCommand}`);
        
        return new Promise((resolve, reject) => {
            const childProcess = spawn('powershell', [
                '-NoProfile', 
                '-ExecutionPolicy', 
                'Bypass', 
                '-Command', 
                `${utf8Setup}${psCommand}`
            ], {
                cwd: this.workingDir,
                env: {
                    ...process.env,
                    PYTHONIOENCODING: 'utf-8',
                    NODE_ENV: 'production',
                    HTTP_PROXY: this.proxyUrl,
                    HTTPS_PROXY: this.proxyUrl
                },
                encoding: 'utf8',
                stdio: ['pipe', 'pipe', 'pipe']
            });
            
            let output = '';
            let errors = '';
            let hasClaudeResponse = false;
            
            // Handle stdout
            childProcess.stdout.on('data', (data) => {
                const chunk = data.toString('utf8');
                console.log(`📥 STDOUT: ${chunk.substring(0, 100)}...`);
                
                output += chunk;
                
                // Check for Claude response
                if (this.isClaudeResponse(chunk)) {
                    hasClaudeResponse = true;
                    console.log('✅ Claude response detected');
                }
                
                // Send streaming callback if provided
                if (options.onStream) {
                    try {
                        options.onStream({
                            type: 'stream',
                            content: chunk,
                            timestamp: new Date().toISOString()
                        });
                    } catch (error) {
                        console.error(`❌ Stream callback error: ${error.message}`);
                    }
                }
            });
            
            // Handle stderr
            childProcess.stderr.on('data', (data) => {
                const chunk = data.toString('utf8');
                console.log(`⚠️  STDERR: ${chunk.substring(0, 100)}...`);
                
                errors += chunk;
                
                // Some Claude output might go to stderr
                if (this.isClaudeResponse(chunk)) {
                    hasClaudeResponse = true;
                    console.log('✅ Claude response detected in stderr');
                }
            });
            
            // Handle process exit
            childProcess.on('exit', (code, signal) => {
                console.log(`🏁 Process exited: code=${code}, signal=${signal}`);
                console.log(`📊 Total output length: ${output.length} chars`);
                console.log(`📊 Total errors length: ${errors.length} chars`);
                console.log(`📊 Claude response detected: ${hasClaudeResponse}`);
                
                // Clean up output
                const cleanOutput = this.cleanOutput(output + errors);
                
                resolve({
                    success: code === 0,
                    exitCode: code,
                    output: cleanOutput,
                    rawOutput: output + errors,
                    hasClaudeResponse,
                    sessionId,
                    timestamp: new Date().toISOString()
                });
            });
            
            // Handle process error
            childProcess.on('error', (error) => {
                console.error(`❌ Process error: ${error.message}`);
                reject(error);
            });
            
            // Set timeout
            if (options.timeout) {
                setTimeout(() => {
                    console.log('⏰ Process timeout - killing...');
                    childProcess.kill();
                    resolve({
                        success: false,
                        exitCode: -1,
                        output: 'Command timed out',
                        rawOutput: output + errors,
                        hasClaudeResponse: false,
                        sessionId,
                        timestamp: new Date().toISOString()
                    });
                }, options.timeout);
            }
        });
    }

    /**
     * Check if output contains Claude response
     */
    isClaudeResponse(chunk) {
        const claudeIndicators = [
            'I understand',
            'I can help',
            'Let me',
            'Here is',
            'Based on',
            'To solve this',
            'I recommend',
            'The solution',
            'You can',
            'This will',
            'First,',
            'Next,',
            'Finally,'
        ];
        
        const jsonIndicators = ['{"type": "assistant"', '"type":"status"'];
        
        // Check for JSON format
        const hasJsonFormat = jsonIndicators.some(indicator => chunk.includes(indicator));
        
        // Check for text patterns
        const hasTextPattern = claudeIndicators.some(indicator => 
            chunk.toLowerCase().includes(indicator.toLowerCase())
        );
        
        return hasJsonFormat || hasTextPattern;
    }

    /**
     * Clean up output by removing system messages
     */
    cleanOutput(output) {
        const systemPatterns = [
            /^Executing:.*$/gm,
            /^Script location:.*$/gm,
            /^Working directory:.*$/gm,
            /^Environment check:.*$/gm,
            /^  ANTHROPIC_API_KEY:.*$/gm,
            /^  ANTHROPIC_BASE_URL:.*$/gm,
            /^Using claude path:.*$/gm,
            /^\[System\.Text\.Encoding\].*$/gm,
            /^\[Console\].*$/gm,
            /^Warning:.*$/gm,
            /^PS>.*$/gm,
            /^\s*$/gm
        ];
        
        let cleanOutput = output;
        
        // Remove system patterns
        systemPatterns.forEach(pattern => {
            cleanOutput = cleanOutput.replace(pattern, '');
        });
        
        // Remove extra empty lines
        cleanOutput = cleanOutput.replace(/\n\s*\n\s*\n/g, '\n\n');
        
        // Trim whitespace
        cleanOutput = cleanOutput.trim();
        
        return cleanOutput;
    }

    /**
     * Generate session ID
     */
    generateSessionId() {
        return 'session_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
    }

    /**
     * Test the executor
     */
    async test() {
        console.log('🧪 Testing Windows Direct Executor...\n');
        
        const testCommands = [
            'echo "Hello World"',
            'claude --version',
            'What is 2+2?'
        ];
        
        for (const command of testCommands) {
            console.log(`📋 Testing command: ${command}`);
            
            try {
                const result = await this.executeCommand(command, {
                    timeout: 30000,
                    onStream: (chunk) => {
                        console.log(`🔄 Stream: ${chunk.content.substring(0, 50)}...`);
                    }
                });
                
                console.log(`✅ Command completed:`);
                console.log(`   Success: ${result.success}`);
                console.log(`   Exit Code: ${result.exitCode}`);
                console.log(`   Claude Response: ${result.hasClaudeResponse}`);
                console.log(`   Output Length: ${result.output.length} chars`);
                
                if (result.output) {
                    console.log(`   Output Preview: ${result.output.substring(0, 100)}...`);
                }
                
                console.log('');
                
            } catch (error) {
                console.log(`❌ Command failed: ${error.message}`);
                console.log('');
            }
        }
    }
}

// Run tests if called directly
if (require.main === module) {
    const executor = new WindowsDirectExecutor();
    executor.test().catch(console.error);
}

module.exports = WindowsDirectExecutor;