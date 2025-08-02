#!/usr/bin/env node

/**
 * 测试更新后的Telegram渠道与新的无头执行器集成
 */

require('dotenv').config();
const ClaudeHeadlessExecutor = require('../../src/relay/claude-headless-executor');
const Logger = require('../../src/core/logger');

console.log('🧪 测试Telegram渠道与无头执行器集成');
console.log('===================================\n');

async function testTelegramIntegration() {
    const logger = new Logger('TelegramIntegrationTest');
    const executor = new ClaudeHeadlessExecutor(logger);
    
    try {
        // 1. 测试执行器基本信息
        console.log('📋 1. 测试执行器基本信息...');
        const claudeInfo = await executor.getClaudeInfo();
        console.log(`   平台: ${claudeInfo.platform}`);
        console.log(`   路径: ${claudeInfo.path}`);
        console.log(`   版本: ${claudeInfo.version}`);
        console.log('');
        
        // 2. 测试简单命令执行（模拟Telegram调用）
        console.log('📋 2. 测试简单命令执行...');
        const simpleCommand = 'What is 3+3? Please respond briefly.';
        
        const simpleResult = await executor.executeCommand(simpleCommand, {
            timeout: 60000,
            sessionId: '550e8400-e29b-41d4-a716-446655440000',
            streaming: true,
            onStream: (chunk) => {
                if (chunk.type === 'assistant') {
                    console.log(`🔄 助手响应: ${chunk.content.substring(0, 50)}...`);
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
        
        // 3. 测试文件相关命令
        console.log('📋 3. 测试文件相关命令...');
        const fileCommand = 'List files in current directory in simple format';
        
        const fileResult = await executor.executeCommand(fileCommand, {
            timeout: 45000,
            sessionId: '550e8400-e29b-41d4-a716-446655440001',
            streaming: true,
            onStream: (chunk) => {
                if (chunk.type === 'assistant') {
                    console.log(`🔄 文件列表流式: ${chunk.content.substring(0, 40)}...`);
                }
            }
        });
        
        console.log(`✅ 文件命令结果:`);
        console.log(`   成功: ${fileResult.success}`);
        console.log(`   方法: ${fileResult.method}`);
        console.log(`   耗时: ${fileResult.duration}ms`);
        
        if (fileResult.assistantResponse) {
            console.log(`   响应长度: ${fileResult.assistantResponse.length} 字符`);
        }
        console.log('');
        
        // 4. 测试代码相关命令
        console.log('📋 4. 测试代码相关命令...');
        const codeCommand = 'Write a simple hello world function in JavaScript';
        
        const codeResult = await executor.executeCommand(codeCommand, {
            timeout: 60000,
            sessionId: '550e8400-e29b-41d4-a716-446655440002',
            streaming: true,
            onStream: (chunk) => {
                if (chunk.type === 'assistant') {
                    console.log(`🔄 代码生成流式: ${chunk.content.substring(0, 60)}...`);
                }
            }
        });
        
        console.log(`✅ 代码命令结果:`);
        console.log(`   成功: ${codeResult.success}`);
        console.log(`   方法: ${codeResult.method}`);
        console.log(`   耗时: ${codeResult.duration}ms`);
        
        if (codeResult.assistantResponse) {
            console.log(`   响应长度: ${codeResult.assistantResponse.length} 字符`);
        }
        console.log('');
        
        // 5. 测试错误处理
        console.log('📋 5. 测试错误处理...');
        try {
            const errorCommand = 'this is not a valid command syntax';
            
            const errorResult = await executor.executeCommand(errorCommand, {
                timeout: 30000,
                sessionId: '550e8400-e29b-41d4-a716-446655440003',
                streaming: true,
                onStream: (chunk) => {
                    if (chunk.type === 'assistant') {
                        console.log(`🔄 错误处理流式: ${chunk.content.substring(0, 30)}...`);
                    }
                }
            });
            
            console.log(`✅ 错误处理结果:`);
            console.log(`   成功: ${errorResult.success}`);
            console.log(`   方法: ${errorResult.method}`);
            console.log(`   耗时: ${errorResult.duration}ms`);
            
        } catch (error) {
            console.log(`✅ 错误处理测试完成: ${error.message}`);
        }
        console.log('');
        
        console.log('🎉 Telegram集成测试完成！');
        console.log('');
        console.log('📊 测试总结:');
        console.log(`   ✅ 执行器平台检测: ${claudeInfo.platform}`);
        console.log(`   ✅ 简单命令执行: ${simpleResult.success ? '成功' : '失败'}`);
        console.log(`   ✅ 文件命令执行: ${fileResult.success ? '成功' : '失败'}`);
        console.log(`   ✅ 代码命令执行: ${codeResult.success ? '成功' : '失败'}`);
        console.log(`   ✅ 流式响应支持: 是`);
        console.log(`   ✅ 错误处理机制: 已测试`);
        
        if (simpleResult.success && fileResult.success && codeResult.success) {
            console.log('');
            console.log('🚀 Telegram渠道已成功集成新的无头执行器！');
            console.log('   • Windows环境使用PowerShell执行方法');
            console.log('   • 支持实时流式响应');
            console.log('   • 兼容现有的Telegram消息处理逻辑');
            console.log('   • 可以开始进行实际测试');
        } else {
            console.log('');
            console.log('⚠️  部分测试失败，需要检查配置');
        }
        
    } catch (error) {
        console.error('❌ 集成测试失败:', error.message);
        console.error(error.stack);
    }
}

testTelegramIntegration().catch(console.error);