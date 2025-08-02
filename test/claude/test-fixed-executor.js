#!/usr/bin/env node

/**
 * 测试修复后的Claude执行器
 */

const ClaudeHeadlessExecutor = require('./src/relay/claude-headless-executor');
const Logger = require('./src/core/logger');

console.log('🧪 测试修复后的Claude执行器');
console.log('========================\n');

async function testFixedExecutor() {
    const logger = new Logger('Test');
    const executor = new ClaudeHeadlessExecutor(logger);
    
    const testCommand = 'echo "Hello from Claude!"';
    
    console.log('📋 测试命令:', testCommand);
    console.log('🚀 开始执行...\n');
    
    try {
        const result = await executor.executeCommand(testCommand, {
            timeout: 60000,
            sessionId: 'test-session'
        });
        
        console.log('✅ 执行完成！');
        console.log('📊 结果详情:');
        console.log(`   成功: ${result.success}`);
        console.log(`   方法: ${result.method}`);
        console.log(`   耗时: ${result.duration}ms`);
        console.log(`   错误: ${result.error || '无'}`);
        
        if (result.assistantResponse) {
            console.log(`\n🤖 Claude响应:`);
            console.log(`   ${result.assistantResponse}`);
        }
        
        if (result.rawOutput) {
            console.log(`\n📄 原始输出:`);
            console.log(`   ${result.rawOutput.substring(0, 200)}${result.rawOutput.length > 200 ? '...' : ''}`);
        }
        
    } catch (error) {
        console.log('❌ 测试失败:', error.message);
    }
}

testFixedExecutor().catch(console.error);