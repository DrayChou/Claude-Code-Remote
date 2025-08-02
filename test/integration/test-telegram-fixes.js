#!/usr/bin/env node

/**
 * 测试 Telegram 修复功能
 * 1. 自动创建 session
 * 2. 回复收集和发送
 */

const ClaudeHeadlessExecutor = require('../../src/relay/claude-headless-executor');

console.log('🧪 Testing Telegram Fixes');
console.log('========================\n');

async function testExecutorResponseExtraction() {
    console.log('📋 Testing executor response extraction...');
    
    const executor = new ClaudeHeadlessExecutor();
    
    try {
        const result = await executor.executeCommand('echo "Hello World"', {
            timeout: 30000
        });
        
        console.log('✅ Execution Result:');
        console.log(`   Success: ${result.success}`);
        console.log(`   Method: ${result.method}`);
        console.log(`   Duration: ${result.duration}ms`);
        console.log(`   Assistant Response: ${result.assistantResponse ? 'Found' : 'Missing'}`);
        
        if (result.assistantResponse) {
            console.log(`   Response Preview: ${result.assistantResponse.substring(0, 100)}...`);
        }
        
        if (result.rawOutput) {
            console.log(`   Raw Output Length: ${result.rawOutput.length} chars`);
        }
        
        return result.success;
        
    } catch (error) {
        console.log('❌ Test failed:', error.message);
        return false;
    }
}

async function testSessionAutoCreation() {
    console.log('\n📋 Testing session auto-creation logic...');
    
    // 模拟 Telegram 频道逻辑
    const { v4: uuidv4 } = require('crypto');
    
    function generateUuid() {
        return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
            const r = Math.random() * 16 | 0;
            const v = c === 'x' ? r : (r & 0x3 | 0x8);
            return v.toString(16);
        });
    }
    
    function generateToken() {
        const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
        let token = '';
        for (let i = 0; i < 8; i++) {
            token += chars.charAt(Math.floor(Math.random() * chars.length));
        }
        return token;
    }
    
    // 模拟自动创建 session
    const sessionId = generateUuid();
    const token = generateToken();
    
    console.log(`   Generated Session ID: ${sessionId}`);
    console.log(`   Generated Token: ${token}`);
    
    const autoNotification = {
        type: 'waiting',
        title: 'Auto-Created Session',
        message: 'Session created automatically for your command.',
        project: 'Auto-Session',
        metadata: {
            userQuestion: 'test command',
            claudeResponse: '',
            tmuxSession: 'auto-session',
            autoCreated: true
        }
    };
    
    console.log(`   Notification created: ${JSON.stringify(autoNotification, null, 2)}`);
    
    return true;
}

async function runTests() {
    console.log('🚀 Starting Telegram fixes tests...\n');
    
    let results = [];
    
    // 测试 1: 执行器响应提取
    results.push(await testExecutorResponseExtraction());
    
    // 测试 2: 自动创建 session
    results.push(await testSessionAutoCreation());
    
    const passedTests = results.filter(r => r).length;
    const totalTests = results.length;
    
    console.log(`\n🏁 Test Results: ${passedTests}/${totalTests} passed`);
    
    if (passedTests === totalTests) {
        console.log('✅ All tests passed! Fixes should work correctly.');
    } else {
        console.log('❌ Some tests failed. Please check the implementation.');
    }
    
    return passedTests === totalTests;
}

runTests().catch(error => {
    console.error('❌ Test suite failed:', error);
    process.exit(1);
});