#!/usr/bin/env node

/**
 * 测试环境变量传递问题
 */

require('dotenv').config();
const { exec } = require('child_process');

async function testEnvVars() {
    console.log('🧪 测试环境变量传递...\n');
    
    // 1. 检查Node.js中的环境变量
    console.log('📋 Node.js中的环境变量:');
    console.log(`   CLAUDE_CLI_PATH: ${process.env.CLAUDE_CLI_PATH}`);
    console.log(`   NODE_TLS_REJECT_UNAUTHORIZED: ${process.env.NODE_TLS_REJECT_UNAUTHORIZED}`);
    console.log('');
    
    // 2. 测试直接调用PowerShell
    console.log('📋 测试直接调用PowerShell:');
    try {
        const result1 = await new Promise((resolve, reject) => {
            exec('powershell -Command "Write-Output $env:CLAUDE_CLI_PATH"', {
                timeout: 5000,
                encoding: 'utf8'
            }, (error, stdout, stderr) => {
                if (error) {
                    reject(error);
                } else {
                    resolve({ stdout: stdout.trim(), stderr: stderr.trim() });
                }
            });
        });
        
        console.log(`   PowerShell环境变量: ${result1.stdout}`);
        console.log(`   错误: ${result1.stderr}`);
    } catch (error) {
        console.log(`   错误: ${error.message}`);
    }
    console.log('');
    
    // 3. 测试传递环境变量给PowerShell
    console.log('📋 测试传递环境变量给PowerShell:');
    const claudePath = process.env.CLAUDE_CLI_PATH || 'claude';
    const testCommand = `powershell -Command "$env:CLAUDE_CLI_PATH='${claudePath}'; Write-Output $env:CLAUDE_CLI_PATH"`;
    
    console.log(`   测试命令: ${testCommand}`);
    
    try {
        const result2 = await new Promise((resolve, reject) => {
            exec(testCommand, {
                timeout: 5000,
                encoding: 'utf8',
                env: {
                    ...process.env,
                    CLAUDE_CLI_PATH: claudePath
                }
            }, (error, stdout, stderr) => {
                if (error) {
                    reject(error);
                } else {
                    resolve({ stdout: stdout.trim(), stderr: stderr.trim() });
                }
            });
        });
        
        console.log(`   结果: ${result2.stdout}`);
        console.log(`   错误: ${result2.stderr}`);
    } catch (error) {
        console.log(`   错误: ${error.message}`);
    }
    console.log('');
    
    // 4. 测试实际执行
    console.log('📋 测试实际执行Claude CLI:');
    const execCommand = `powershell -ExecutionPolicy Bypass -File "${claudePath}" --version`;
    console.log(`   执行命令: ${execCommand}`);
    
    try {
        const result3 = await new Promise((resolve, reject) => {
            exec(execCommand, {
                timeout: 10000,
                encoding: 'utf8',
                env: {
                    ...process.env,
                    CLAUDE_CLI_PATH: claudePath
                }
            }, (error, stdout, stderr) => {
                if (error) {
                    reject(error);
                } else {
                    resolve({ stdout: stdout.trim(), stderr: stderr.trim() });
                }
            });
        });
        
        console.log(`   ✅ 执行成功: ${result3.stdout}`);
        console.log(`   错误输出: ${result3.stderr}`);
    } catch (error) {
        console.log(`   ❌ 执行失败: ${error.message}`);
    }
}

testEnvVars().catch(console.error);