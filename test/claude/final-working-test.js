#!/usr/bin/env node

/**
 * Final working PowerShell execution method for Claude CLI
 * Based on best practices from documentation and successful test results
 */

require('dotenv').config();

console.log('🚀 FINAL WORKING POWERSHELL EXECUTION');
console.log('====================================\n');

const { spawn } = require('child_process');

async function executeClaudeCommand(command, options = {}) {
    console.log(`📋 Executing Claude command: ${command}`);
    
    // Use the configured CLAUDE_CLI_PATH
    const claudePath = process.env.CLAUDE_CLI_PATH || 'C:\\Users\\dray\\scoop\\shims\\cc.tuzi.ps1';
    
    // Build PowerShell command using the -File approach for better reliability
    const psArgs = [
        '-NoProfile',
        '-ExecutionPolicy', 
        'Bypass',
        '-File',
        claudePath,
        command,
        '-p',
        '--output-format',
        'stream-json',
        '--verbose'
    ];
    
    // Add optional arguments
    if (options.sessionId) {
        psArgs.push('--session-id', options.sessionId);
    }
    
    console.log(`🔧 PowerShell command: powershell.exe ${psArgs.join(' ')}`);
    
    return new Promise((resolve, reject) => {
        const ps = spawn('powershell.exe', psArgs, {
            cwd: process.cwd(),
            env: {
                ...process.env,
                PYTHONIOENCODING: 'utf-8',
                NODE_ENV: 'production',
                HTTP_PROXY: process.env.HTTP_PROXY,
                HTTPS_PROXY: process.env.HTTP_PROXY
            },
            encoding: 'utf8',
            stdio: ['pipe', 'pipe', 'pipe']
        });
        
        let output = '';
        let errors = '';
        let hasClaudeResponse = false;
        let responseComplete = false;
        let startTime = Date.now();
        
        // Handle stdout
        ps.stdout.on('data', (data) => {
            const chunk = data.toString('utf8');
            console.log(`📥 STDOUT: ${chunk.substring(0, 100)}...`);
            
            output += chunk;
            
            // Check for Claude JSON response patterns
            if (chunk.includes('"type":"assistant"') || chunk.includes('"type":"result"')) {
                hasClaudeResponse = true;
                console.log('✅ Claude JSON response detected');
            }
            
            // Check for completion
            if (chunk.includes('"subtype":"success"') || chunk.includes('"subtype":"error"')) {
                responseComplete = true;
                console.log('✅ Claude response complete detected');
            }
            
            // Send streaming callback if provided
            if (options.onStream) {
                options.onStream({
                    type: 'stream',
                    content: chunk,
                    timestamp: new Date().toISOString()
                });
            }
        });
        
        // Handle stderr
        ps.stderr.on('data', (data) => {
            const chunk = data.toString('utf8');
            console.log(`⚠️  STDERR: ${chunk.substring(0, 100)}...`);
            
            errors += chunk;
            
            // Some warnings might go to stderr but don't affect the response
            if (!chunk.includes('Warning') && !chunk.includes('DEP0190')) {
                console.log('📋 Non-warning stderr detected');
            }
        });
        
        // Handle process errors
        ps.on('error', (error) => {
            console.error(`❌ Process error: ${error.message}`);
            reject(error);
        });
        
        // Handle process exit
        ps.on('close', (code) => {
            const duration = Date.now() - startTime;
            console.log(`🏁 Process closed: code=${code}, duration=${duration}ms`);
            console.log(`📊 Total output length: ${output.length} chars`);
            console.log(`📊 Total errors length: ${errors.length} chars`);
            console.log(`📊 Claude response detected: ${hasClaudeResponse}`);
            console.log(`📊 Response complete: ${responseComplete}`);
            
            // Determine success based on response detection, not just exit code
            const success = hasClaudeResponse && responseComplete;
            
            // Extract Claude's actual response from JSON
            const claudeResponse = extractClaudeResponse(output);
            
            resolve({
                success: success,
                exitCode: code,
                output: claudeResponse,
                rawOutput: output + errors,
                hasClaudeResponse,
                responseComplete,
                duration: duration,
                timestamp: new Date().toISOString()
            });
        });
        
        // Set timeout - only if not already completed
        if (options.timeout) {
            setTimeout(() => {
                if (!responseComplete) {
                    console.log('⏰ Process timeout - killing...');
                    ps.kill();
                    resolve({
                        success: false,
                        exitCode: -1,
                        output: 'Command timed out',
                        rawOutput: output + errors,
                        hasClaudeResponse: false,
                        responseComplete: false,
                        duration: Date.now() - startTime,
                        timestamp: new Date().toISOString()
                    });
                }
            }, options.timeout);
        }
    });
}

function extractClaudeResponse(output) {
    try {
        // Parse JSON streaming output
        const lines = output.split('\n');
        let assistantMessage = '';
        
        for (const line of lines) {
            try {
                const json = JSON.parse(line.trim());
                if (json.type === 'assistant' && json.message && json.message.content) {
                    assistantMessage += json.message.content;
                } else if (json.type === 'result' && json.subtype === 'success') {
                    // End of response
                    break;
                }
            } catch (e) {
                // Ignore non-JSON lines
                continue;
            }
        }
        
        return assistantMessage.trim();
    } catch (error) {
        console.log(`📋 Failed to parse JSON response: ${error.message}`);
        // Fallback to simple cleaning
        return output
            .replace(/^.*\{.*\}.*$/gm, '') // Remove JSON lines
            .replace(/^\s*$/gm, '') // Remove empty lines
            .trim();
    }
}

async function runTests() {
    console.log('🧪 Testing final PowerShell execution method...\n');
    
    const testCommands = [
        'echo "Hello World"',
        'What is 2+2? Please respond briefly.',
        'List the current directory files in a simple format'
    ];
    
    for (const command of testCommands) {
        console.log(`📋 Testing command: ${command}`);
        
        try {
            const result = await executeClaudeCommand(command, {
                timeout: 60000,
                onStream: (chunk) => {
                    console.log(`🔄 Stream: ${chunk.content.substring(0, 50)}...`);
                }
            });
            
            console.log(`✅ Command completed:`);
            console.log(`   Success: ${result.success}`);
            console.log(`   Exit Code: ${result.exitCode}`);
            console.log(`   Duration: ${result.duration}ms`);
            console.log(`   Claude Response: ${result.hasClaudeResponse}`);
            console.log(`   Response Complete: ${result.responseComplete}`);
            console.log(`   Output Length: ${result.output.length} chars`);
            
            if (result.output) {
                console.log(`   Output: ${result.output}`);
            }
            
            if (result.rawOutput) {
                console.log(`   Raw Output Preview: ${result.rawOutput.substring(0, 200)}...`);
            }
            
            console.log('');
            
        } catch (error) {
            console.log(`❌ Command failed: ${error.message}`);
            console.log('');
        }
    }
}

runTests().catch(console.error);