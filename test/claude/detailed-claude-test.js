#!/usr/bin/env node

/**
 * 详细的Claude CLI执行测试
 */

const { exec } = require('child_process');
const fs = require('fs');
const path = require('path');

console.log('🧪 Claude CLI 详细执行测试');
console.log('========================\n');

async function runDetailedTest() {
    const tests = [
        {
            name: 'PowerShell版本检查',
            command: 'powershell.exe -NoProfile -ExecutionPolicy Bypass -Command "& \'C:\\Users\\dray\\scoop\\persist\\nodejs\\bin\\claude.ps1\' --version"',
            timeout: 10000
        },
        {
            name: 'PowerShell简单命令',
            command: 'powershell.exe -NoProfile -ExecutionPolicy Bypass -Command "& \'C:\\Users\\dray\\scoop\\persist\\nodejs\\bin\\claude.ps1\' -p \'echo \"test\"\'"',
            timeout: 30000
        },
        {
            name: '直接Node.js调用',
            command: '"C:\\Users\\dray\\scoop\\apps\\nodejs\\current\\node.exe" "C:\\Users\\dray\\scoop\\persist\\nodejs\\bin\\node_modules\\@anthropic-ai\\claude-code\\cli.js" --version',
            timeout: 10000
        },
        {
            name: '直接Node.js简单命令',
            command: '"C:\\Users\\dray\\scoop\\apps\\nodejs\\current\\node.exe" "C:\\Users\\dray\\scoop\\persist\\nodejs\\bin\\node_modules\\@anthropic-ai\\claude-code\\cli.js" -p "echo test"',
            timeout: 60000
        }
    ];

    for (const test of tests) {
        console.log(`📋 测试: ${test.name}`);
        console.log(`   命令: ${test.command}`);
        
        try {
            const result = await executeCommand(test.command, test.timeout);
            console.log(`✅ 成功 (${result.duration}ms)`);
            console.log(`   输出: ${result.output.substring(0, 100)}${result.output.length > 100 ? '...' : ''}`);
            if (result.error) {
                console.log(`   错误: ${result.error}`);
            }
        } catch (error) {
            console.log(`❌ 失败: ${error.message}`);
        }
        
        console.log('');
    }
}

function executeCommand(command, timeout) {
    return new Promise((resolve, reject) => {
        const startTime = Date.now();
        
        exec(command, {
            cwd: process.cwd(),
            env: {
                ...process.env,
                ANTHROPIC_API_KEY: 'sk-ant-oat01-f51f80a45ce5feee5cd3de05d8e29bd365f1a9ef2dcaeed35ef22cdf8e7b65ee',
                ANTHROPIC_BASE_URL: 'https://relay11.gaccode.com/claudecode',
                CLAUDE_CODE_GIT_BASH_PATH: 'C:\\Users\\dray\\scoop\\shims\\bash.EXE',
                PYTHONIOENCODING: 'utf-8',
                NODE_ENV: 'production',
                HTTP_PROXY: process.env.HTTP_PROXY,
                HTTPS_PROXY: process.env.HTTP_PROXY
            },
            encoding: 'utf8',
            timeout: timeout
        }, (error, stdout, stderr) => {
            const duration = Date.now() - startTime;
            
            resolve({
                success: !error,
                output: stdout || '',
                error: stderr || (error ? error.message : ''),
                duration
            });
        });
    });
}

runDetailedTest().catch(console.error);