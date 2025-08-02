#!/usr/bin/env node

/**
 * Simple test for Windows direct execution
 */

require('dotenv').config();

console.log('🚀 SIMPLE WINDOWS EXECUTION TEST');
console.log('=================================\n');

const { spawn } = require('child_process');

async function testSimpleCommand() {
    console.log('📋 Testing simple command...');
    
    const claudePath = process.env.CLAUDE_CLI_PATH || 'C:\\Users\\dray\\scoop\\shims\\cc.tuzi.ps1';
    const command = 'echo "Hello World"';
    
    console.log(`Claude Path: ${claudePath}`);
    console.log(`Command: ${command}`);
    
    const utf8Setup = '[Console]::InputEncoding = [Console]::OutputEncoding = New-Object System.Text.UTF8Encoding; ';
    const psCommand = `& '${claudePath}' '${command}' -p --output-format stream-json --verbose`;
    
    console.log(`PowerShell Command: ${psCommand}`);
    
    return new Promise((resolve, reject) => {
        const childProcess = spawn('powershell', [
            '-NoProfile', 
            '-ExecutionPolicy', 
            'Bypass', 
            '-Command', 
            `${utf8Setup}${psCommand}`
        ], {
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
        
        childProcess.stdout.on('data', (data) => {
            const chunk = data.toString('utf8');
            console.log(`📥 STDOUT: ${chunk.substring(0, 100)}...`);
            output += chunk;
        });
        
        childProcess.stderr.on('data', (data) => {
            const chunk = data.toString('utf8');
            console.log(`⚠️  STDERR: ${chunk.substring(0, 100)}...`);
            errors += chunk;
        });
        
        childProcess.on('exit', (code, signal) => {
            console.log(`🏁 Process exited: code=${code}, signal=${signal}`);
            console.log(`📊 Output length: ${output.length} chars`);
            console.log(`📊 Errors length: ${errors.length} chars`);
            
            if (code === 0) {
                resolve({ success: true, output, errors });
            } else {
                reject(new Error(`Process exited with code ${code}`));
            }
        });
        
        childProcess.on('error', (error) => {
            console.error(`❌ Process error: ${error.message}`);
            reject(error);
        });
    });
}

async function runTest() {
    try {
        const result = await testSimpleCommand();
        console.log('✅ Test completed successfully!');
        console.log('Result:', result);
    } catch (error) {
        console.error('❌ Test failed:', error.message);
    }
}

runTest();