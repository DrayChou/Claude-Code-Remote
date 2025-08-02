#!/usr/bin/env node

/**
 * GLM 4.5 CLI 配置检查和修复
 */

require('dotenv').config();
const { exec } = require('child_process');

async function checkGLMConfig() {
    console.log('🔧 GLM 4.5 CLI 配置检查和修复\n');
    
    const claudePath = process.env.CLAUDE_CLI_PATH;
    
    // 1. 检查当前配置
    console.log('📋 当前配置:');
    try {
        const result = await new Promise((resolve, reject) => {
            exec(`powershell -ExecutionPolicy Bypass -File "${claudePath}" config list`, {
                timeout: 10000,
                encoding: 'utf8'
            }, (error, stdout, stderr) => {
                if (error) {
                    reject(error);
                } else {
                    resolve({ stdout: stdout.trim(), stderr: stderr.trim() });
                }
            });
        });
        
        console.log('   当前配置:');
        console.log(`   ${result.stdout}`);
        
        // 检查是否有API密钥相关配置
        if (result.stdout.includes('apiKey') || result.stdout.includes('api_key') || result.stdout.includes('ANTHROPIC_API_KEY')) {
            console.log('   ✅ 发现API密钥配置');
        } else {
            console.log('   ❌ 未发现API密钥配置');
        }
        
    } catch (error) {
        console.log(`   ❌ 获取配置失败: ${error.message}`);
    }
    
    console.log('');
    
    // 2. 检查环境变量
    console.log('📋 环境变量检查:');
    const apiEnvVars = [
        'ANTHROPIC_API_KEY',
        'OPENAI_API_KEY',
        'GLM_API_KEY',
        'CLAUDE_API_KEY'
    ];
    
    let hasApiKey = false;
    apiEnvVars.forEach(env => {
        if (process.env[env]) {
            console.log(`   ✅ ${env}: ${process.env[env].substring(0, 10)}...`);
            hasApiKey = true;
        } else {
            console.log(`   ❌ ${env}: 未设置`);
        }
    });
    
    if (!hasApiKey) {
        console.log('   ⚠️  没有找到任何API密钥环境变量');
    }
    
    console.log('');
    
    // 3. 尝试设置API密钥（如果存在）
    if (hasApiKey) {
        console.log('📋 尝试配置GLM 4.5 CLI:');
        
        // 找到第一个可用的API密钥
        const apiKey = apiEnvVars.find(env => process.env[env]);
        
        if (apiKey) {
            console.log(`   使用 ${apiKey} 进行配置`);
            
            try {
                const setResult = await new Promise((resolve, reject) => {
                    exec(`powershell -ExecutionPolicy Bypass -File "${claudePath}" config set apiKey ${process.env[apiKey]}`, {
                        timeout: 15000,
                        encoding: 'utf8'
                    }, (error, stdout, stderr) => {
                        if (error) {
                            reject(error);
                        } else {
                            resolve({ stdout: stdout.trim(), stderr: stderr.trim() });
                        }
                    });
                });
                
                console.log('   ✅ API密钥设置成功');
                console.log(`   ${setResult.stdout}`);
                
            } catch (error) {
                console.log(`   ❌ API密钥设置失败: ${error.message}`);
            }
        }
    } else {
        console.log('📋 如何配置GLM 4.5 CLI:');
        console.log('   1. 获取GLM API密钥');
        console.log('   2. 设置环境变量:');
        console.log('      setx GLM_API_KEY "your-api-key"');
        console.log('   3. 或者在.env文件中添加:');
        console.log('      GLM_API_KEY=your-api-key');
        console.log('   4. 然后运行此脚本进行配置');
    }
    
    console.log('');
    
    // 4. 测试CLI是否工作
    console.log('📋 测试GLM 4.5 CLI:');
    
    const testCommand = `powershell -ExecutionPolicy Bypass -File "${claudePath}" -p --output-format text "echo test"`;
    console.log(`   测试命令: ${testCommand}`);
    
    try {
        const testResult = await new Promise((resolve, reject) => {
            exec(testCommand, {
                timeout: 30000,
                encoding: 'utf8'
            }, (error, stdout, stderr) => {
                if (error) {
                    reject(error);
                } else {
                    resolve({ stdout: stdout.trim(), stderr: stderr.trim() });
                }
            });
        });
        
        console.log('   ✅ CLI测试成功');
        if (testResult.stdout) {
            console.log(`   输出: ${testResult.stdout.substring(0, 200)}...`);
        }
        
    } catch (error) {
        console.log(`   ❌ CLI测试失败: ${error.message}`);
        console.log('   这通常意味着API密钥未正确配置');
    }
}

checkGLMConfig().catch(console.error);