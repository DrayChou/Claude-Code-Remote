#!/usr/bin/env node

/**
 * Final working implementation with proper JSON streaming
 * This is the recommended approach for Telegram bot integration
 */

require('dotenv').config();

console.log('🚀 FINAL JSON STREAMING IMPLEMENTATION');
console.log('=====================================\n');

const { spawn } = require('child_process');

async function executeClaudeWithStreaming(command, options = {}) {
    console.log(`📋 Executing: ${command}`);
    
    // Use direct claude.ps1 path - no wrapper script
    const claudePath = 'C:\\Users\\dray\\scoop\\persist\\nodejs\\bin\\claude.ps1';
    
    // Build PowerShell command for direct execution
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
    
    console.log(`🔧 PowerShell: ${psArgs.slice(0, 4).join(' ')} "${psArgs[4]}"`);
    
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
        let jsonChunks = [];
        let assistantResponse = '';
        let isComplete = false;
        let startTime = Date.now();
        let timeoutId = null;
        
        // Safe completion function
        const complete = (result) => {
            if (timeoutId) {
                clearTimeout(timeoutId);
                timeoutId = null;
            }
            resolve(result);
        };
        
        // Process JSON chunks for streaming
        const processJsonChunk = (chunk) => {
            try {
                const json = JSON.parse(chunk);
                jsonChunks.push(json);
                
                // Extract assistant content
                if (json.type === 'assistant' && json.message && json.message.content) {
                    assistantResponse += json.message.content;
                    
                    // Send assistant content via streaming callback
                    if (options.onStream) {
                        options.onStream({
                            type: 'assistant',
                            content: json.message.content,
                            timestamp: new Date().toISOString(),
                            messageId: json.message.id
                        });
                    }
                }
                
                // Check for completion
                if (json.type === 'result' && (json.subtype === 'success' || json.subtype === 'error')) {
                    isComplete = true;
                    
                    // Send completion via streaming callback
                    if (options.onStream) {
                        options.onStream({
                            type: 'result',
                            subtype: json.subtype,
                            success: json.subtype === 'success',
                            duration: json.duration_ms,
                            timestamp: new Date().toISOString()
                        });
                    }
                }
                
                return json;
            } catch (e) {
                // Not a JSON chunk, ignore
                return null;
            }
        };
        
        // Handle stdout - this is where JSON streaming happens
        ps.stdout.on('data', (data) => {
            const chunk = data.toString('utf8');
            
            // Process each line as potential JSON
            const lines = chunk.split('\n');
            for (const line of lines) {
                const trimmed = line.trim();
                if (trimmed) {
                    const json = processJsonChunk(trimmed);
                    if (json) {
                        console.log(`📦 JSON: ${json.type}${json.subtype ? ':' + json.subtype : ''}`);
                    }
                }
            }
            
            output += chunk;
        });
        
        // Handle stderr (warnings only)
        ps.stderr.on('data', (data) => {
            const chunk = data.toString('utf8');
            // Only log non-warning messages
            if (!chunk.includes('Warning') && !chunk.includes('DEP0190')) {
                console.log(`⚠️  STDERR: ${chunk.substring(0, 100)}...`);
            }
        });
        
        // Handle process errors
        ps.on('error', (error) => {
            console.error(`❌ Process error: ${error.message}`);
            complete({
                success: false,
                error: error.message,
                jsonChunks: [],
                assistantResponse: '',
                isComplete: false,
                duration: Date.now() - startTime
            });
        });
        
        // Handle process completion
        ps.on('close', (code) => {
            const duration = Date.now() - startTime;
            console.log(`🏁 Process closed: code=${code}, duration=${duration}ms`);
            console.log(`📊 JSON chunks: ${jsonChunks.length}`);
            console.log(`📊 Assistant response: ${assistantResponse.length} chars`);
            console.log(`📊 Complete: ${isComplete}`);
            
            complete({
                success: isComplete,
                exitCode: code,
                jsonChunks: jsonChunks,
                assistantResponse: assistantResponse,
                rawOutput: output,
                isComplete: isComplete,
                duration: duration,
                timestamp: new Date().toISOString()
            });
        });
        
        // Set timeout only if not already completed
        if (options.timeout) {
            timeoutId = setTimeout(() => {
                if (!isComplete) {
                    console.log('⏰ Timeout - killing process...');
                    ps.kill();
                    complete({
                        success: false,
                        exitCode: -1,
                        jsonChunks: jsonChunks,
                        assistantResponse: assistantResponse,
                        rawOutput: output,
                        isComplete: false,
                        duration: Date.now() - startTime,
                        timestamp: new Date().toISOString()
                    });
                }
            }, options.timeout);
        }
    });
}

async function demonstrateStreaming() {
    console.log('🧪 Demonstrating JSON streaming capabilities...\n');
    
    const command = 'What is 2+2? Please explain step by step.';
    
    console.log(`📋 Command: ${command}`);
    console.log('📡 Starting JSON stream...\n');
    
    try {
        const result = await executeClaudeWithStreaming(command, {
            timeout: 60000,
            onStream: (streamChunk) => {
                console.log(`🔄 STREAM [${streamChunk.type}]:`);
                if (streamChunk.type === 'assistant') {
                    console.log(`   Content: "${streamChunk.content.substring(0, 50)}${streamChunk.content.length > 50 ? '...' : ''}"`);
                } else if (streamChunk.type === 'result') {
                    console.log(`   Result: ${streamChunk.subtype} (${streamChunk.duration}ms)`);
                }
                console.log('');
            }
        });
        
        console.log('✅ Streaming demonstration complete:');
        console.log(`   Success: ${result.success}`);
        console.log(`   Duration: ${result.duration}ms`);
        console.log(`   JSON Chunks: ${result.jsonChunks.length}`);
        console.log(`   Assistant Response: ${result.assistantResponse.length} chars`);
        
        if (result.assistantResponse) {
            console.log(`\n📝 Final Response:`);
            console.log(result.assistantResponse);
        }
        
        // Show JSON structure
        console.log(`\n📦 JSON Chunk Types:`);
        const chunkTypes = {};
        result.jsonChunks.forEach(chunk => {
            const key = chunk.type + (chunk.subtype ? ':' + chunk.subtype : '');
            chunkTypes[key] = (chunkTypes[key] || 0) + 1;
        });
        
        Object.entries(chunkTypes).forEach(([type, count]) => {
            console.log(`   ${type}: ${count} chunks`);
        });
        
    } catch (error) {
        console.error(`❌ Demonstration failed: ${error.message}`);
    }
}

demonstrateStreaming().catch(console.error);