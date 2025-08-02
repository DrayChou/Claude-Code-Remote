#!/usr/bin/env node

/**
 * Optimized PowerShell execution method based on best practices
 * Uses spawn with proper PowerShell arguments for better reliability
 */

require('dotenv').config();

console.log('🚀 OPTIMIZED POWERSHELL EXECUTION TEST');
console.log('=====================================\n');

const { spawn } = require('child_process');

async function executeWithPowerShell(command, options = {}) {
    console.log(`📋 Executing: ${command}`);
    
    // Use the direct claude command instead of the ps1 wrapper
    const claudePath = 'C:\\Users\\dray\\scoop\\persist\\nodejs\\bin\\claude.ps1';
    
    // Build PowerShell command with proper arguments
    const psArgs = [
        '-NoProfile',
        '-ExecutionPolicy', 
        'Bypass',
        '-Command',
        `[Console]::InputEncoding = [Console]::OutputEncoding = New-Object System.Text.UTF8Encoding; & '${claudePath}' '${command}' -p --output-format stream-json --verbose`
    ];
    
    console.log(`🔧 PowerShell args: ${JSON.stringify(psArgs)}`);
    
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
        
        // Handle stdout
        ps.stdout.on('data', (data) => {
            const chunk = data.toString('utf8');
            console.log(`📥 STDOUT: ${chunk.substring(0, 100)}...`);
            
            output += chunk;
            
            // Check for Claude response patterns
            if (chunk.includes('I understand') || chunk.includes('I can help') || chunk.includes('Let me') || chunk.includes('Here is')) {
                hasClaudeResponse = true;
                console.log('✅ Claude response detected');
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
            
            // Some Claude output might go to stderr
            if (chunk.includes('I understand') || chunk.includes('I can help')) {
                hasClaudeResponse = true;
                console.log('✅ Claude response detected in stderr');
            }
        });
        
        // Handle process errors
        ps.on('error', (error) => {
            console.error(`❌ Process error: ${error.message}`);
            reject(error);
        });
        
        // Handle process exit
        ps.on('close', (code) => {
            console.log(`🏁 Process closed: code=${code}`);
            console.log(`📊 Total output length: ${output.length} chars`);
            console.log(`📊 Total errors length: ${errors.length} chars`);
            console.log(`📊 Claude response detected: ${hasClaudeResponse}`);
            
            // Clean up output
            const cleanOutput = cleanPowerShellOutput(output + errors);
            
            resolve({
                success: code === 0,
                exitCode: code,
                output: cleanOutput,
                rawOutput: output + errors,
                hasClaudeResponse,
                timestamp: new Date().toISOString()
            });
        });
        
        // Set timeout
        if (options.timeout) {
            setTimeout(() => {
                console.log('⏰ Process timeout - killing...');
                ps.kill();
                resolve({
                    success: false,
                    exitCode: -1,
                    output: 'Command timed out',
                    rawOutput: output + errors,
                    hasClaudeResponse: false,
                    timestamp: new Date().toISOString()
                });
            }, options.timeout);
        }
    });
}

function cleanPowerShellOutput(output) {
    // Remove PowerShell system messages
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

async function runTests() {
    console.log('🧪 Testing optimized PowerShell execution...\n');
    
    const testCommands = [
        'echo "Hello World"',
        'What is 2+2? Please respond briefly.',
        'List the files in current directory'
    ];
    
    for (const command of testCommands) {
        console.log(`📋 Testing command: ${command}`);
        
        try {
            const result = await executeWithPowerShell(command, {
                timeout: 45000,
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
                console.log(`   Output Preview: ${result.output.substring(0, 200)}...`);
            }
            
            console.log('');
            
        } catch (error) {
            console.log(`❌ Command failed: ${error.message}`);
            console.log('');
        }
    }
}

runTests().catch(console.error);