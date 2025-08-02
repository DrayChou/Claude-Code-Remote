#!/usr/bin/env node

/**
 * Test script to verify different execution methods for Claude CLI
 * This script tests the three alternative execution methods:
 * 1. child_process.exec with streaming
 * 2. Direct spawn with optimized settings
 * 3. PowerShell command execution
 */

const path = require('path');
const fs = require('fs');

// Load environment variables
require('dotenv').config();

console.log('🧪 TESTING ALTERNATIVE EXECUTION METHODS');
console.log('========================================\n');

// Test configuration
const testCommand = 'echo "Hello from Claude CLI"';
const claudePath = process.env.CLAUDE_CLI_PATH || 'claude';

console.log(`📋 Test Configuration:`);
console.log(`   Command: ${testCommand}`);
console.log(`   Claude Path: ${claudePath}`);
console.log(`   Platform: ${process.platform}`);
console.log(`   Node Version: ${process.version}\n`);

// Method 1: Test child_process.exec
console.log('📝 METHOD 1: child_process.exec');
console.log('-------------------------------');

const { exec } = require('child_process');

const testExecMethod = () => {
    return new Promise((resolve, reject) => {
        console.log('🔧 Testing exec method...');
        
        const fullCommand = `${claudePath} "${testCommand}" -p --output-format stream-json --verbose`;
        console.log(`🔧 Command: ${fullCommand}`);
        
        const childProcess = exec(fullCommand, {
            encoding: 'utf8',
            maxBuffer: 1024 * 1024 * 10,
            timeout: 30000,
            env: {
                ...process.env,
                PYTHONIOENCODING: 'utf-8',
                NODE_ENV: 'production'
            }
        });
        
        let output = '';
        let errorOutput = '';
        
        childProcess.stdout.on('data', (data) => {
            const chunk = data.toString('utf8');
            console.log(`📥 STDOUT: ${chunk.substring(0, 100)}...`);
            output += chunk;
        });
        
        childProcess.stderr.on('data', (data) => {
            const chunk = data.toString('utf8');
            console.log(`⚠️  STDERR: ${chunk.substring(0, 100)}...`);
            errorOutput += chunk;
        });
        
        childProcess.on('exit', (code, signal) => {
            console.log(`🏁 EXEC EXITED: code=${code}, signal=${signal}`);
            console.log(`📊 Total output length: ${output.length} chars`);
            console.log(`📊 Total error length: ${errorOutput.length} chars`);
            
            if (code === 0) {
                resolve({ success: true, output, errorOutput });
            } else {
                reject(new Error(`EXEC process exited with code ${code}`));
            }
        });
        
        childProcess.on('error', (error) => {
            console.error(`❌ EXEC ERROR: ${error.message}`);
            reject(error);
        });
    });
};

// Method 2: Test direct spawn
console.log('\n📝 METHOD 2: Direct spawn');
console.log('-------------------------');

const testSpawnMethod = () => {
    return new Promise((resolve, reject) => {
        console.log('🔧 Testing spawn method...');
        
        const { spawn } = require('child_process');
        const args = [testCommand, '-p', '--output-format', 'stream-json', '--verbose'];
        
        console.log(`🔧 Command: ${claudePath}`);
        console.log(`🔧 Args: ${JSON.stringify(args)}`);
        
        const childProcess = spawn(claudePath, args, {
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
        let errorOutput = '';
        
        childProcess.stdout.on('data', (data) => {
            const chunk = data.toString('utf8');
            console.log(`📥 SPAWN STDOUT: ${chunk.substring(0, 100)}...`);
            output += chunk;
        });
        
        childProcess.stderr.on('data', (data) => {
            const chunk = data.toString('utf8');
            console.log(`⚠️  SPAWN STDERR: ${chunk.substring(0, 100)}...`);
            errorOutput += chunk;
        });
        
        childProcess.on('exit', (code, signal) => {
            console.log(`🏁 SPAWN EXITED: code=${code}, signal=${signal}`);
            console.log(`📊 Total output length: ${output.length} chars`);
            console.log(`📊 Total error length: ${errorOutput.length} chars`);
            
            if (code === 0) {
                resolve({ success: true, output, errorOutput });
            } else {
                reject(new Error(`Spawn process exited with code ${code}`));
            }
        });
        
        childProcess.on('error', (error) => {
            console.error(`❌ SPAWN ERROR: ${error.message}`);
            reject(error);
        });
    });
};

// Method 3: Test PowerShell command (Windows only)
console.log('\n📝 METHOD 3: PowerShell command');
console.log('------------------------------');

const testPowerShellMethod = () => {
    return new Promise((resolve, reject) => {
        if (process.platform !== 'win32') {
            console.log('⚠️  Skipping PowerShell test on non-Windows platform');
            resolve({ success: true, output: 'Skipped on non-Windows', errorOutput: '' });
            return;
        }
        
        console.log('🔧 Testing PowerShell method...');
        
        const utf8Setup = '[Console]::InputEncoding = [Console]::OutputEncoding = New-Object System.Text.UTF8Encoding; ';
        const psCommand = `& '${claudePath}' '${testCommand}' -p --output-format stream-json --verbose`;
        const fullCommand = `powershell -NoProfile -ExecutionPolicy Bypass -Command "${utf8Setup}${psCommand}"`;
        
        console.log(`🔧 PowerShell command: ${fullCommand}`);
        
        const childProcess = exec(fullCommand, {
            encoding: 'utf8',
            maxBuffer: 1024 * 1024 * 10,
            timeout: 30000,
            env: {
                ...process.env,
                PYTHONIOENCODING: 'utf-8',
                NODE_ENV: 'production'
            }
        });
        
        let output = '';
        let errorOutput = '';
        
        childProcess.stdout.on('data', (data) => {
            const chunk = data.toString('utf8');
            console.log(`📥 PWSH STDOUT: ${chunk.substring(0, 100)}...`);
            output += chunk;
        });
        
        childProcess.stderr.on('data', (data) => {
            const chunk = data.toString('utf8');
            console.log(`⚠️  PWSH STDERR: ${chunk.substring(0, 100)}...`);
            errorOutput += chunk;
        });
        
        childProcess.on('exit', (code, signal) => {
            console.log(`🏁 PWSH EXITED: code=${code}, signal=${signal}`);
            console.log(`📊 Total output length: ${output.length} chars`);
            console.log(`📊 Total error length: ${errorOutput.length} chars`);
            
            if (code === 0) {
                resolve({ success: true, output, errorOutput });
            } else {
                reject(new Error(`PowerShell process exited with code ${code}`));
            }
        });
        
        childProcess.on('error', (error) => {
            console.error(`❌ PWSH ERROR: ${error.message}`);
            reject(error);
        });
    });
};

// Run all tests
async function runAllTests() {
    const results = {
        method1: { name: 'child_process.exec', success: false, error: null },
        method2: { name: 'Direct spawn', success: false, error: null },
        method3: { name: 'PowerShell command', success: false, error: null }
    };
    
    // Test Method 1
    try {
        await testExecMethod();
        results.method1.success = true;
        console.log('✅ Method 1 (exec) - SUCCESS');
    } catch (error) {
        results.method1.success = false;
        results.method1.error = error.message;
        console.log(`❌ Method 1 (exec) - FAILED: ${error.message}`);
    }
    
    // Test Method 2
    try {
        await testSpawnMethod();
        results.method2.success = true;
        console.log('✅ Method 2 (spawn) - SUCCESS');
    } catch (error) {
        results.method2.success = false;
        results.method2.error = error.message;
        console.log(`❌ Method 2 (spawn) - FAILED: ${error.message}`);
    }
    
    // Test Method 3
    try {
        await testPowerShellMethod();
        results.method3.success = true;
        console.log('✅ Method 3 (PowerShell) - SUCCESS');
    } catch (error) {
        results.method3.success = false;
        results.method3.error = error.message;
        console.log(`❌ Method 3 (PowerShell) - FAILED: ${error.message}`);
    }
    
    // Summary
    console.log('\n🎯 TEST SUMMARY');
    console.log('===============');
    
    const successfulMethods = Object.values(results).filter(r => r.success).length;
    console.log(`✅ Successful methods: ${successfulMethods}/3`);
    
    Object.entries(results).forEach(([key, result]) => {
        const status = result.success ? '✅' : '❌';
        console.log(`${status} ${result.name}: ${result.success ? 'SUCCESS' : result.error}`);
    });
    
    if (successfulMethods > 0) {
        console.log('\n🎉 At least one method works! The fallback system should be able to find a working method.');
    } else {
        console.log('\n💥 All methods failed. Need to investigate Claude CLI installation and configuration.');
    }
    
    return results;
}

// Run the tests
runAllTests().catch(console.error);