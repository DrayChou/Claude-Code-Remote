#!/usr/bin/env node

/**
 * 测试不同的Claude CLI调用方式
 */

require('dotenv').config();
const { exec } = require('child_process');

async function testDifferentCommands() {
    console.log('🧪 测试不同的Claude CLI调用方式...\n');
    
    const claudePath = process.env.CLAUDE_CLI_PATH;
    const testCommands = [
        {
            name: '版本检查',
            command: `powershell -ExecutionPolicy Bypass -File "${claudePath}" --version`,
            timeout: 10000
        },
        {
            name: '帮助信息',
            command: `powershell -ExecutionPolicy Bypass -File "${claudePath}" --help`,
            timeout: 15000
        },
        {
            name: '简单命令 - 无-p',
            command: `powershell -ExecutionPolicy Bypass -File "${claudePath}" "echo test"`,
            timeout: 30000
        },
        {
            name: '简单命令 - 带-p',
            command: `powershell -ExecutionPolicy Bypass -File "${claudePath}" -p "echo test"`,
            timeout: 30000
        },
        {
            name: '简单命令 - 带-p和text格式',
            command: `powershell -ExecutionPolicy Bypass -File "${claudePath}" -p --output-format text "echo test"`,
            timeout: 30000
        },
        {
            name: '简单命令 - 带-p和json格式',
            command: `powershell -ExecutionPolicy Bypass -File "${claudePath}" -p --output-format json "echo test"`,
            timeout: 30000
        }
    ];
    
    for (const test of testCommands) {
        console.log(`📋 测试: ${test.name}`);
        console.log(`   命令: ${test.command}`);
        
        try {
            const result = await new Promise((resolve, reject) => {
                exec(test.command, {
                    timeout: test.timeout,
                    encoding: 'utf8',
                    env: {
                        ...process.env,
                        CLAUDE_CLI_PATH: claudePath
                    }
                }, (error, stdout, stderr) => {
                    if (error) {
                        resolve({ success: false, error: error.message, stdout, stderr });
                    } else {
                        resolve({ success: true, stdout, stderr });
                    }
                });
            });
            
            if (result.success) {
                console.log(`   ✅ 成功`);
                if (result.stdout) {
                    const output = result.stdout.trim();
                    if (output.length > 200) {
                        console.log(`   输出: ${output.substring(0, 200)}...`);
                    } else {
                        console.log(`   输出: ${output}`);
                    }
                }
            } else {
                console.log(`   ❌ 失败: ${result.error}`);
                if (result.stderr) {
                    console.log(`   错误: ${result.stderr.trim()}`);
                }
            }
            
        } catch (error) {
            console.log(`   ❌ 超时: ${error.message}`);
        }
        
        console.log('');
    }
}

testDifferentCommands().catch(console.error);