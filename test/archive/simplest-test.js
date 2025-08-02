#!/usr/bin/env node

/**
 * 最简单的测试 - 不使用流式处理
 */

require('dotenv').config();
const ClaudeHeadlessExecutor = require('./src/relay/claude-headless-executor');
const Logger = require('./src/core/logger');

console.log('🧪 最简单测试 - 无流式处理');
console.log('========================\n');

async function simplestTest() {
    const logger = new Logger('SimplestTest');
    const executor = new ClaudeHeadlessExecutor(logger);
    
    try {
        console.log('📋 执行简单命令...');
        const result = await executor.executeCommand('echo "test"', {
            timeout: 180000, // 增加到3分钟
            streaming: false  // 禁用流式处理
        });
        
        console.log('\n✅ 测试结果:');
        console.log(`   成功: ${result.success}`);
        console.log(`   方法: ${result.method}`);
        console.log(`   耗时: ${result.duration}ms`);
        console.log(`   完整: ${result.isComplete}`);
        console.log(`   退出码: ${result.exitCode}`);
        
        if (result.assistantResponse) {
            console.log(`   响应: ${result.assistantResponse}`);
        }
        
        if (result.rawOutput) {
            console.log(`   原始输出长度: ${result.rawOutput.length} 字符`);
        }
        
        if (result.success) {
            console.log('\n🎉 执行器基本功能正常！');
        } else {
            console.log('\n❌ 仍有问题需要调试');
        }
        
    } catch (error) {
        console.error('❌ 测试失败:', error.message);
    }
}

simplestTest().catch(console.error);