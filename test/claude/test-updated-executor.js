#!/usr/bin/env node

/**
 * 测试更新后的claude-headless-executor.js
 * 验证跨平台支持和Windows PowerShell执行方法
 */

require('dotenv').config();
const ClaudeHeadlessExecutor = require('./src/relay/claude-headless-executor');
const Logger = require('./src/core/logger');

console.log('🧪 测试更新后的Claude无头执行器');
console.log('================================\n');

async function testExecutor() {
    const logger = new Logger('TestExecutor');
    const executor = new ClaudeHeadlessExecutor(logger);
    
    try {
        // 1. 获取Claude信息
        console.log('📋 1. 获取Claude版本信息...');
        const claudeInfo = await executor.getClaudeInfo();
        console.log(`   平台: ${claudeInfo.platform}`);
        console.log(`   路径: ${claudeInfo.path}`);
        console.log(`   版本: ${claudeInfo.version}`);
        console.log('');
        
        // 2. 测试简单命令
        console.log('📋 2. 测试简单命令执行...');
        const simpleResult = await executor.executeCommand('What is 2+2? Please respond briefly.', {
            timeout: 60000,
            streaming: true,
            onStream: (chunk) => {
                if (chunk.type === 'assistant') {
                    console.log(`🔄 流式响应: ${chunk.content.substring(0, 50)}...`);
                } else if (chunk.type === 'result') {
                    console.log(`🔄 执行结果: ${chunk.subtype} (${chunk.duration}ms)`);
                }
            }
        });
        
        console.log(`✅ 简单命令结果:`);
        console.log(`   成功: ${simpleResult.success}`);
        console.log(`   方法: ${simpleResult.method}`);
        console.log(`   耗时: ${simpleResult.duration}ms`);
        console.log(`   JSON块: ${simpleResult.jsonChunks?.length || 0}`);
        console.log(`   完整响应: ${simpleResult.isComplete}`);
        
        if (simpleResult.assistantResponse) {
            console.log(`   响应内容: ${simpleResult.assistantResponse}`);
        }
        console.log('');
        
        // 3. 测试带会话ID的命令
        console.log('📋 3. 测试带会话ID的命令...');
        const sessionResult = await executor.executeCommand('Remember that my name is TestUser', {
            timeout: 60000,
            sessionId: 'test-session-123',
            streaming: true,
            onStream: (chunk) => {
                if (chunk.type === 'assistant') {
                    console.log(`🔄 会话流式: ${chunk.content.substring(0, 30)}...`);
                }
            }
        });
        
        console.log(`✅ 会话命令结果:`);
        console.log(`   成功: ${sessionResult.success}`);
        console.log(`   方法: ${sessionResult.method}`);
        console.log(`   耗时: ${sessionResult.duration}ms`);
        console.log('');
        
        // 4. 测试列表命令
        console.log('📋 4. 测试文件列表命令...');
        const listResult = await executor.executeCommand('List files in current directory', {
            timeout: 45000,
            streaming: true,
            onStream: (chunk) => {
                if (chunk.type === 'assistant') {
                    console.log(`🔄 列表流式: ${chunk.content.substring(0, 40)}...`);
                }
            }
        });
        
        console.log(`✅ 列表命令结果:`);
        console.log(`   成功: ${listResult.success}`);
        console.log(`   方法: ${listResult.method}`);
        console.log(`   耗时: ${listResult.duration}ms`);
        
        if (listResult.assistantResponse) {
            console.log(`   响应长度: ${listResult.assistantResponse.length} 字符`);
        }
        console.log('');
        
        console.log('🎉 所有测试完成！');
        
    } catch (error) {
        console.error('❌ 测试失败:', error.message);
        console.error(error.stack);
    }
}

testExecutor().catch(console.error);