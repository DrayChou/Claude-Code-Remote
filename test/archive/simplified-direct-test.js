#!/usr/bin/env node

/**
 * Simplified direct Claude execution bypassing wrapper scripts
 * This approach calls Claude directly without the cc.tuzi.ps1 wrapper
 */

require('dotenv').config();

console.log('🚀 SIMPLIFIED DIRECT CLAUDE EXECUTION');
console.log('=====================================\n');

const { spawn } = require('child_process');

async function executeClaudeDirectly(command, options = {}) {
    console.log(`📋 Executing Claude directly: ${command}`);
    
    // Use direct claude.ps1 path instead of the wrapper
    const claudePath = 'C:\\Users\\dray\\scoop\\persist\\nodejs\\bin\\claude.ps1';
    
    // Build PowerShell command to call Claude directly
    const psCommand = `& '${claudePath}' '${command}' -p --output-format stream-json --verbose`;
    
    // Add optional arguments
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
    
    console.log(`🔧 Direct PowerShell command: powershell.exe ${psArgs.slice(0, 4).join(' ')} "${psArgs[4]}"`);
    
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
            if (chunk.includes('"type":"assistant"')) {
                hasClaudeResponse = true;
                console.log('✅ Claude assistant response detected');
            }
            
            // Check for completion
            if (chunk.includes('"subtype":"success"') || chunk.includes('"subtype":"error"')) {
                responseComplete = true;
                console.log('✅ Claude response complete');
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
            // Only log important stderr messages (not warnings)
            if (!chunk.includes('Warning') && !chunk.includes('DEP0190')) {
                console.log(`⚠️  STDERR: ${chunk.substring(0, 100)}...`);
                errors += chunk;
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
            console.log(`📊 Claude response detected: ${hasClaudeResponse}`);
            console.log(`📊 Response complete: ${responseComplete}`);
            
            // Success is determined by having a complete Claude response
            const success = hasClaudeResponse && responseComplete;
            
            // Extract Claude's response from JSON
            const claudeResponse = extractClaudeResponse(output);
            
            resolve({
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
        
        // Set timeout
        if (options.timeout) {
            setTimeout(() => {
                if (!responseComplete) {
                    console.log('⏰ Process timeout - killing...');
                    ps.kill();
                    resolve({
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
        // Parse JSON streaming output to extract Claude's message
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
                // Skip non-JSON lines
                continue;
            }
        }
        
        return assistantMessage.trim();
    } catch (error) {
        console.log(`📋 JSON parsing failed, fallback to cleaning: ${error.message}`);
        return cleanOutput(output);
    }
}

function cleanOutput(output) {
    // Remove system messages and clean up
    return output
        .replace(/^\[.*\].*$/gm, '') // Remove bracketed system messages
        .replace(/^Warning:.*$/gm, '') // Remove warnings
        .replace(/^\s*$/gm, '') // Remove empty lines
        .replace(/\n\s*\n/g, '\n') // Remove extra line breaks
        .trim();
}

async function runTests() {
    console.log('🧪 Testing simplified direct Claude execution...\n');
    
    const testCommands = [
        'echo "Hello World"',
        'What is 2+2? Please respond briefly.',
        'List files in current directory in simple format'
    ];
    
    for (const command of testCommands) {
        console.log(`📋 Testing command: ${command}`);
        
        try {
            const result = await executeClaudeDirectly(command, {
                timeout: 30000,
                onStream: (chunk) => {
                    console.log(`🔄 Stream: ${chunk.content.substring(0, 50)}...`);
                }
            });
            
            console.log(`✅ Command completed:`);
            console.log(`   Success: ${result.success}`);
            console.log(`   Duration: ${result.duration}ms`);
            console.log(`   Claude Response: ${result.hasClaudeResponse}`);
            console.log(`   Response Complete: ${result.responseComplete}`);
            console.log(`   Output Length: ${result.output.length} chars`);
            
            if (result.output) {
                console.log(`   Claude Response: ${result.output}`);
            }
            
            console.log('');
            
        } catch (error) {
            console.log(`❌ Command failed: ${error.message}`);
            console.log('');
        }
    }
}

runTests().catch(console.error);