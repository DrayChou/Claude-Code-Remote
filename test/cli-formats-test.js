#!/usr/bin/env node

/**
 * Test GLM 4.5 CLI with different output formats
 */

require('dotenv').config();
const { exec } = require('child_process');

async function testCLIFormats() {
    console.log('🧪 Testing GLM 4.5 CLI with different formats...\n');
    
    const formats = [
        { name: 'Text', args: ['--output-format', 'text'] },
        { name: 'JSON', args: ['--output-format', 'json'] },
        { name: 'Stream JSON', args: ['--output-format', 'stream-json'] }
    ];
    
    const testCommand = 'echo "test successful"';
    
    for (const format of formats) {
        console.log(`📝 Testing ${format.name} format...`);
        
        const escapedCommand = testCommand.replace(/"/g, '\\"');
        const claudePath = process.env.CLAUDE_CLI_PATH.replace(/\\/g, '\\\\');
        const fullCommand = `powershell -ExecutionPolicy Bypass -File "${claudePath}" -p ${format.args.join(' ')} --verbose "${escapedCommand}"`;
        
        console.log(`   Command: ${fullCommand}`);
        
        try {
            const result = await new Promise((resolve, reject) => {
                exec(fullCommand, {
                    timeout: 30000,
                    encoding: 'utf8',
                    maxBuffer: 1024 * 1024
                }, (error, stdout, stderr) => {
                    if (error) {
                        resolve({ success: false, error: error.message, stderr, stdout });
                    } else {
                        resolve({ success: true, stdout, stderr });
                    }
                });
            });
            
            if (result.success) {
                console.log(`   ✅ ${format.name} format - SUCCESS`);
                console.log(`   Output length: ${result.stdout.length} characters`);
                if (result.stdout.length > 0) {
                    console.log(`   First 200 chars: ${result.stdout.substring(0, 200)}...`);
                }
            } else {
                console.log(`   ❌ ${format.name} format - FAILED`);
                console.log(`   Error: ${result.error}`);
                if (result.stderr) {
                    console.log(`   Stderr: ${result.stderr.substring(0, 200)}...`);
                }
            }
            
        } catch (error) {
            console.log(`   ❌ ${format.name} format - TIMEOUT: ${error.message}`);
        }
        
        console.log('');
    }
}

testCLIFormats().catch(console.error);