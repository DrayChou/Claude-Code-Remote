#!/usr/bin/env node

/**
 * Test Claude CLI with echo command
 */

require('dotenv').config();

console.log('🚀 CLAUDE CLI ECHO TEST');
console.log('======================\n');

const { spawn } = require('child_process');

async function testEchoCommand() {
    console.log('📋 Testing Claude CLI echo command...');
    
    const claudePath = 'C:\\Users\\dray\\scoop\\persist\\nodejs\\bin\\claude.ps1';
    const command = 'echo "Hello World"';
    
    return new Promise((resolve, reject) => {
        const child = spawn('powershell', [
            '-NoProfile', 
            '-ExecutionPolicy', 
            'Bypass', 
            '-Command', 
            `& '${claudePath}' '${command}'`
        ], {
            cwd: process.cwd(),
            env: {
                ...process.env,
                PYTHONIOENCODING: 'utf-8',
                NODE_ENV: 'production'
            },
            encoding: 'utf8',
            stdio: ['pipe', 'pipe', 'pipe'],
            timeout: 30000
        });
        
        let output = '';
        let errors = '';
        
        child.stdout.on('data', (data) => {
            const chunk = data.toString('utf8');
            console.log(`📥 STDOUT: ${chunk.substring(0, 100)}...`);
            output += chunk;
        });
        
        child.stderr.on('data', (data) => {
            const chunk = data.toString('utf8');
            console.log(`⚠️  STDERR: ${chunk.substring(0, 100)}...`);
            errors += chunk;
        });
        
        child.on('exit', (code, signal) => {
            console.log(`🏁 Process exited: code=${code}, signal=${signal}`);
            console.log(`📊 Total output length: ${output.length} chars`);
            console.log(`📊 Total errors length: ${errors.length} chars`);
            
            if (code === 0) {
                resolve({ success: true, output, errors });
            } else {
                reject(new Error(`Process exited with code ${code}`));
            }
        });
        
        child.on('error', (error) => {
            console.error(`❌ Process error: ${error.message}`);
            reject(error);
        });
        
        child.on('timeout', () => {
            console.log('⏰ Process timeout');
            child.kill();
            resolve({ success: false, output: 'Timeout', errors });
        });
    });
}

async function runTest() {
    try {
        const result = await testEchoCommand();
        console.log('✅ Test completed successfully!');
        console.log('Output preview:', result.output.substring(0, 200));
    } catch (error) {
        console.error('❌ Test failed:', error.message);
    }
}

runTest();