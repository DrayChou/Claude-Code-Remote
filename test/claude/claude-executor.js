#!/usr/bin/env node

/**
 * Final working Claude execution implementation for Telegram bot
 * This provides proper JSON streaming and can be integrated into tmux-injector.js
 * 
 * Usage:
 * const result = await executeClaudeCommand('your command', {
 *   timeout: 60000,
 *   onStream: (chunk) => {
 *     // Handle streaming chunks
 *     if (chunk.type === 'assistant') {
 *       // Send assistant response to Telegram
 *     }
 *   }
 * });
 */

const { spawn } = require('child_process');

/**
 * Execute Claude command with proper JSON streaming
 * @param {string} command - The command to execute
 * @param {Object} options - Execution options
 * @param {number} options.timeout - Timeout in milliseconds
 * @param {Function} options.onStream - Streaming callback function
 * @param {string} options.sessionId - Optional session ID
 * @returns {Promise<Object>} Execution result
 */
async function executeClaudeCommand(command, options = {}) {
    // Use direct claude.ps1 path for best performance
    const claudePath = 'C:\\Users\\dray\\scoop\\persist\\nodejs\\bin\\claude.ps1';
    
    // Build PowerShell command
    let psCommand = `& '${claudePath}' '${command}' -p --output-format stream-json --verbose`;
    
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
        
        // Handle stdout - JSON streaming happens here
        ps.stdout.on('data', (data) => {
            const chunk = data.toString('utf8');
            
            // Process each line as potential JSON
            const lines = chunk.split('\n');
            for (const line of lines) {
                const trimmed = line.trim();
                if (trimmed) {
                    processJsonChunk(trimmed);
                }
            }
            
            output += chunk;
        });
        
        // Handle stderr (warnings only)
        ps.stderr.on('data', (data) => {
            const chunk = data.toString('utf8');
            // Only log non-warning messages if needed
            // Ignore warnings and deprecation notices
        });
        
        // Handle process errors
        ps.on('error', (error) => {
            complete({
                success: false,
                error: error.message,
                jsonChunks: [],
                assistantResponse: '',
                isComplete: false,
                duration: Date.now() - startTime,
                timestamp: new Date().toISOString()
            });
        });
        
        // Handle process completion
        ps.on('close', (code) => {
            const duration = Date.now() - startTime;
            
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
        
        // Set timeout
        if (options.timeout) {
            timeoutId = setTimeout(() => {
                if (!isComplete) {
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

// Export for use in other modules
module.exports = { executeClaudeCommand };

// Test function if called directly
if (require.main === module) {
    async function test() {
        console.log('🧪 Testing Claude execution with streaming...\n');
        
        try {
            const result = await executeClaudeCommand('What is 3+3? Please respond briefly.', {
                timeout: 45000,
                onStream: (chunk) => {
                    console.log(`🔄 [${chunk.type}]: ${chunk.type === 'assistant' ? chunk.content.substring(0, 30) + '...' : chunk.subtype}`);
                }
            });
            
            console.log('\n✅ Test Results:');
            console.log(`   Success: ${result.success}`);
            console.log(`   Duration: ${result.duration}ms`);
            console.log(`   JSON Chunks: ${result.jsonChunks.length}`);
            console.log(`   Assistant Response: ${result.assistantResponse.length} chars`);
            console.log(`   Complete: ${result.isComplete}`);
            
            if (result.assistantResponse) {
                console.log(`\n📝 Response: ${result.assistantResponse}`);
            }
            
        } catch (error) {
            console.error('❌ Test failed:', error.message);
        }
    }
    
    test();
}