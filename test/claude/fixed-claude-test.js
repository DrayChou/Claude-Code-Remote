#!/usr/bin/env node

/**
 * 修复的Claude CLI执行器 - 直接调用Node.js和Claude CLI
 */

const { exec } = require('child_process');
const path = require('path');

console.log('🧪 修复的Claude CLI测试');
console.log('====================\n');

async function testFixedClaude() {
    const claudeBaseDir = 'C:\\Users\\dray\\scoop\\persist\\nodejs\\bin';
    const nodePath = 'C:\\Users\\dray\\scoop\\apps\\nodejs\\current\\node.exe';
    const cliPath = path.join(claudeBaseDir, 'node_modules', '@anthropic-ai', 'claude-code', 'cli.js');
    
    const command = 'echo "test"';
    
    // 直接调用Node.js和Claude CLI
    const fullCommand = `"${nodePath}" "${cliPath}" -p "${command}"`;
    
    console.log('📋 执行修复的Claude命令...');
    console.log(`   Node.js路径: ${nodePath}`);
    console.log(`   CLI路径: ${cliPath}`);
    console.log(`   完整命令: ${fullCommand}`);
    
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
            timeout: 60000 // 60秒超时
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

testFixedClaude().catch(console.error);