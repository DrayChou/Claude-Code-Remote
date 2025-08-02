#!/usr/bin/env node

/**
 * 简单的Claude CLI测试 - 不通过执行器
 */

const { exec } = require('child_process');

console.log('🧪 简单Claude CLI测试');
console.log('==================\n');

async function testSimpleClaude() {
    const nodePath = 'C:\\Users\\dray\\scoop\\apps\\nodejs\\current\\node.exe';
    const cliPath = 'C:\\Users\\dray\\scoop\\persist\\nodejs\\bin\\node_modules\\@anthropic-ai\\claude-code\\cli.js';
    
    const tests = [
        {
            name: '版本检查',
            command: `"${nodePath}" "${cliPath}" --version`,
            timeout: 10000
        },
        {
            name: '帮助信息',
            command: `"${nodePath}" "${cliPath}" --help`,
            timeout: 10000
        },
        {
            name: '简单命令',
            command: `"${nodePath}" "${cliPath}" -p "echo test"`,
            timeout: 30000
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
                HTTPS_PROXY: process.env.HTTP_PROXY,
                NODE_OPTIONS: '--max-old-space-size=4096'
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

testSimpleClaude().catch(console.error);