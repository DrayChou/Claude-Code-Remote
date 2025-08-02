#!/usr/bin/env node

/**
 * Final fixed version with proper timeout handling
 * This resolves the timeout issue that was killing completed processes
 */

require('dotenv').config();

console.log('🚀 FINAL FIXED CLAUDE EXECUTION');
console.log('================================\n');

const { spawn } = require('child_process');

async function executeClaudeFixed(command, options = {}) {
    console.log(`📋 Executing Claude: ${command}`);
    
    const claudePath = 'C:\\Users\\dray\\scoop\\persist\\nodejs\\bin\\claude.ps1';
    const psCommand = `& '${claudePath}' '${command}' -p --output-format stream-json --verbose`;
    
    if (options.sessionId) {
        psCommand += ` --session-id ${options.sessionId}`;
    }
    
    const psArgs = [
        '-NoProfile',
        '-ExecutionPolicy', 
        'Bypass',
        '-Command',
        `[Console]::InputEncoding = [Console]::OutputEncoding = New-Object System.Text.UTF8Encoding; ${psCommand}`
    ];
    
    console.log(`🔧 Command: powershell.exe ${psArgs.slice(0, 4).join(' ')} "${psArgs[4]}"`);
    
    return new Promise((resolve, reject) => {
        const ps = spawn('powershell.exe', psArgs, {
            cwd: process.cwd(),
            env: {
                ...process.env,
                PYTHONIOENCODING: 'utf-8',
                NODE_ENV: 'production'
            },
            encoding: 'utf8',
            stdio: ['pipe', 'pipe', 'pipe']
        });
        
        let output = '';
        let errors = '';
        let hasClaudeResponse = false;
        let responseComplete = false;
        let startTime = Date.now();
        let timeoutId = null;
        
        // Clear timeout and resolve
        const complete = (result) => {
            if (timeoutId) {
                clearTimeout(timeoutId);
                timeoutId = null;
            }
            resolve(result);
        };
        
        // Handle stdout
        ps.stdout.on('data', (data) => {
            const chunk = data.toString('utf8');
            console.log(`📥 STDOUT: ${chunk.substring(0, 80)}...`);
            
            output += chunk;
            
            if (chunk.includes('"type":"assistant"')) {
                hasClaudeResponse = true;
                console.log('✅ Assistant response detected');
            }
            
            if (chunk.includes('"subtype":"success"') || chunk.includes('"subtype":"error"')) {
                responseComplete = true;
                console.log('✅ Response complete detected');
            }
            
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
            if (!chunk.includes('Warning') && !chunk.includes('DEP0190')) {
                console.log(`⚠️  STDERR: ${chunk.substring(0, 80)}...`);
                errors += chunk;
            }
        });
        
        // Handle process errors
        ps.on('error', (error) => {
            console.error(`❌ Process error: ${error.message}`);
            complete({
                success: false,
                exitCode: -1,
                output: `Process error: ${error.message}`,
                rawOutput: output + errors,
                hasClaudeResponse: false,
                responseComplete: false,
                duration: Date.now() - startTime,
                timestamp: new Date().toISOString()
            });
        });
        
        // Handle process exit
        ps.on('close', (code) => {
            const duration = Date.now() - startTime;
            console.log(`🏁 Process closed: code=${code}, duration=${duration}ms`);
            
            const success = hasClaudeResponse && responseComplete;
            const claudeResponse = extractClaudeResponse(output);
            
            complete({
                success: success,
                exitCode: code,
                output: claudeResponse,
                rawOutput: output,
                hasClaudeResponse,
                responseComplete,
                duration: duration,
                timestamp: new Date().toISOString()
            });
        });
        
        // Set timeout with proper cleanup
        if (options.timeout) {
            timeoutId = setTimeout(() => {
                if (!responseComplete) {
                    console.log('⏰ Process timeout - killing...');
                    ps.kill();
                    complete({
                        success: false,
                        exitCode: -1,
                        output: 'Command timed out',
                        rawOutput: output,
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
        const lines = output.split('\n');
        let assistantMessage = '';
        
        for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed) continue;
            
            try {
                const json = JSON.parse(trimmed);
                if (json.type === 'assistant' && json.message && json.message.content) {
                    assistantMessage += json.message.content;
                }
            } catch (e) {
                continue;
            }
        }
        
        return assistantMessage.trim();
    } catch (error) {
        return output
            .replace(/^\[.*\].*$/gm, '')
            .replace(/^Warning:.*$/gm, '')
            .replace(/^\s*$/gm, '')
            .replace(/\n\s*\n/g, '\n')
            .trim();
    }
}

async function runTests() {
    console.log('🧪 Testing final fixed Claude execution...\n');
    
    const testCommands = [
        'echo "Hello World"',
        'What is 2+2? Please respond briefly.',
        'List files in current directory in simple format'
    ];
    
    for (const command of testCommands) {
        console.log(`📋 Testing: ${command}`);
        
        try {
            const result = await executeClaudeFixed(command, {
                timeout: 45000,
                onStream: (chunk) => {
                    console.log(`🔄 Stream: ${chunk.content.substring(0, 40)}...`);
                }
            });
            
            console.log(`✅ Result:`);
            console.log(`   Success: ${result.success}`);
            console.log(`   Duration: ${result.duration}ms`);
            console.log(`   Response: ${result.hasClaudeResponse && result.responseComplete}`);
            
            if (result.output) {
                console.log(`   Output: ${result.output.substring(0, 100)}${result.output.length > 100 ? '...' : ''}`);
            }
            
            console.log('');
            
        } catch (error) {
            console.log(`❌ Failed: ${error.message}\n`);
        }
    }
}

runTests().catch(console.error);