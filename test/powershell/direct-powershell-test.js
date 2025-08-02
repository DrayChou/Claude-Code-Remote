#!/usr/bin/env node

/**
 * 最简单的PowerShell测试 - 直接调用Claude CLI
 */

const { exec } = require('child_process');
const path = require('path');

console.log('🧪 PowerShell直接调用测试');
console.log('======================\n');

async function testDirectPowerShell() {
    const claudePath = 'C:\\Users\\dray\\scoop\\persist\\nodejs\\bin\\claude.ps1';
    const command = 'echo "test"';
    
    // 构建PowerShell命令
    const psCommand = `& '${claudePath}' -p '${command}'`;
    const fullCommand = `powershell.exe -NoProfile -ExecutionPolicy Bypass -Command "${psCommand}"`;
    
    console.log('📋 执行PowerShell命令...');
    console.log(`   命令: ${fullCommand}`);
    
    return new Promise((resolve) => {
        const startTime = Date.now();
        
        exec(fullCommand, {
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
            timeout: 30000 // 30秒超时
        }, (error, stdout, stderr) => {
            const duration = Date.now() - startTime;
            
            console.log(`\n⏱️  执行时间: ${duration}ms`);
            
            if (error) {
                console.log('❌ 执行失败:');
                console.log(`   错误: ${error.message}`);
                console.log(`   退出码: ${error.code}`);
                console.log(`   错误输出: ${stderr}`);
                
                resolve({ success: false, error: error.message, duration });
            } else {
                console.log('✅ 执行成功!');
                console.log(`   输出长度: ${stdout.length} 字符`);
                console.log(`   错误输出: ${stderr.length} 字符`);
                
                // 显示前200个字符的输出
                const preview = stdout.length > 200 ? stdout.substring(0, 200) + '...' : stdout;
                console.log(`   输出预览: ${preview}`);
                
                resolve({ success: true, output: stdout, duration });
            }
        });
    });
}

testDirectPowerShell().catch(console.error);