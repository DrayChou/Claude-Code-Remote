#!/usr/bin/env node

/**
 * 简化测试 - 验证无头执行器的基本功能
 */

require('dotenv').config();
const ClaudeHeadlessExecutor = require('./src/relay/claude-headless-executor');
const Logger = require('./src/core/logger');

console.log('🧪 简化测试 - 验证无头执行器');
console.log('============================\n');

async function simpleTest() {
    const logger = new Logger('SimpleTest');
    const executor = new ClaudeHeadlessExecutor(logger);
    
    try {
        console.log('📋 测试基本信息...');
        const claudeInfo = await executor.getClaudeInfo();
        console.log(`   平台: ${claudeInfo.platform}`);
        console.log(`   路径: ${claudeInfo.path}`);
        console.log(`   版本: ${claudeInfo.version}`);
        console.log('');
        
        console.log('📋 执行简单命令...');
        // 生成新的随机Session ID
        const newSessionId = 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
            const r = Math.random() * 16 | 0;
            const v = c === 'x' ? r : (r & 0x3 | 0x8);
            return v.toString(16);
        });
        
        console.log(`🎲 使用新的Session ID: ${newSessionId}`);
        
        const result = await executor.executeCommand('What is 1+1? Answer in one word.', {
            timeout: 30000,
            sessionId: newSessionId,
            streaming: true,
            onStream: (chunk) => {
                if (chunk.type === 'assistant') {
                    console.log(`🔄 ${chunk.content.substring(0, 30)}...`);
                } else if (chunk.type === 'result') {
                    console.log(`🏁 ${chunk.subtype} (${chunk.duration}ms)`);
                }
            }
        });
        
        console.log('\n✅ 测试结果:');
        console.log(`   成功: ${result.success}`);
        console.log(`   方法: ${result.method}`);
        console.log(`   耗时: ${result.duration}ms`);
        console.log(`   完整: ${result.isComplete}`);
        
        if (result.assistantResponse) {
            console.log(`   响应: ${result.assistantResponse}`);
        }
        
        if (result.success) {
            console.log('\n🎉 无头执行器工作正常！');
            console.log('✅ Telegram渠道集成准备就绪');
        } else {
            console.log('\n❌ 执行器有问题，需要调试');
        }
        
    } catch (error) {
        console.error('❌ 测试失败:', error.message);
    }
}

simpleTest().catch(console.error);