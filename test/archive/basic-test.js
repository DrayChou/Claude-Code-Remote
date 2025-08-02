#!/usr/bin/env node

/**
 * Simple test to check Claude CLI basic functionality
 */

require('dotenv').config();

console.log('🚀 BASIC CLAUDE CLI TEST');
console.log('========================\n');

const { spawn } = require('child_process');

async function testClaudeVersion() {
    console.log('📋 Testing Claude CLI version...');
    
    const claudePath = 'C:\\Users\\dray\\scoop\\persist\\nodejs\\bin\\claude.ps1';
    
    return new Promise((resolve, reject) => {
        const child = spawn('powershell', [
            '-NoProfile', 
            '-ExecutionPolicy', 
            'Bypass', 
            '-Command', 
            `& '${claudePath}' --version`
        ], {
            cwd: process.cwd(),
            env: {
                ...process.env,
                PYTHONIOENCODING: 'utf-8',
                NODE_ENV: 'production'
            },
            encoding: 'utf8',
            stdio: ['pipe', 'pipe', 'pipe'],
            timeout: 10000
        });
        
        let output = '';
        let errors = '';
        
        child.stdout.on('data', (data) => {
            const chunk = data.toString('utf8');
            console.log(`📥 STDOUT: ${chunk}`);
            output += chunk;
        });
        
        child.stderr.on('data', (data) => {
            const chunk = data.toString('utf8');
            console.log(`⚠️  STDERR: ${chunk}`);
            errors += chunk;
        });
        
        child.on('exit', (code, signal) => {
            console.log(`🏁 Process exited: code=${code}, signal=${signal}`);
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
        const result = await testClaudeVersion();
        console.log('✅ Test completed successfully!');
        console.log('Result:', result);
    } catch (error) {
        console.error('❌ Test failed:', error.message);
    }
}

runTest();