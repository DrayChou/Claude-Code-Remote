#!/usr/bin/env node

/**
 * 测试Claude CLI是否工作
 */

const { exec } = require('child_process');

console.log('🧪 Claude CLI 基础功能测试');
console.log('=========================\n');

async function testClaudeVersion() {
    console.log('📋 测试Claude CLI版本...');
    
    const claudePath = 'C:\\Users\\dray\\scoop\\persist\\nodejs\\bin\\claude.ps1';
    const psCommand = `& '${claudePath}' --version`;
    const fullCommand = `powershell.exe -NoProfile -ExecutionPolicy Bypass -Command "${psCommand}"`;
    
    console.log(`命令: ${fullCommand}`);
    
    return new Promise((resolve) => {
        const startTime = Date.now();
        
        exec(fullCommand, {
            cwd: process.cwd(),
            env: {
                ...process.env,
                ANTHROPIC_API_KEY: 'sk-ant-oat01-f51f80a45ce5feee5cd3de05d8e29bd365f1a9ef2dcaeed35ef22cdf8e7b65ee',
                ANTHROPIC_BASE_URL: 'https://relay11.gaccode.com/claudecode',
                CLAUDE_CODE_GIT_BASH_PATH: 'C:\\Users\\dray\\scoop\\shims\\bash.EXE',
                PYTHON_ENV: 'production'
            },
            encoding: 'utf8',
            timeout: 10000 // 10秒超时
        }, (error, stdout, stderr) => {
            const duration = Date.now() - startTime;
            
            console.log(`\n⏱️  执行时间: ${duration}ms`);
            
            if (error) {
                console.log('❌ 版本检查失败:');
                console.log(`   错误: ${error.message}`);
                console.log(`   退出码: ${error.code}`);
                console.log(`   错误输出: ${stderr}`);
                
                resolve({ success: false, error: error.message });
            } else {
                console.log('✅ 版本检查成功!');
                console.log(`   版本: ${stdout.trim()}`);
                
                resolve({ success: true, version: stdout.trim() });
            }
        });
    });
}

testClaudeVersion().catch(console.error);