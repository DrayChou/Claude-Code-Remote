#!/usr/bin/env node

/**
 * 测试修改后的 claude-headless-executor (spawn 版本)
 */

const ClaudeHeadlessExecutor = require('./src/relay/claude-headless-executor');

console.log('🧪 Testing Claude Headless Executor (spawn version)');
console.log('================================================\n');

async function testSpawnExecutor() {
    const executor = new ClaudeHeadlessExecutor();
    
    // 显示配置信息
    console.log('📋 Configuration:');
    console.log(`   Platform: ${executor.platform}`);
    console.log(`   Is Windows: ${executor.isWindows}`);
    console.log(`   Claude Path: ${executor.claudePath}`);
    console.log('');
    
    const testCommands = [
        'echo "Hello from spawn executor"',
        '你好，请简单回答你是谁？',
        'What is 2+2? Please be brief.'
    ];
    
    for (let i = 0; i < testCommands.length; i++) {
        const command = testCommands[i];
        console.log(`📝 Test ${i + 1}: ${command}`);
        console.log('-----------------------------------');
        
        try {
            const startTime = Date.now();
            
            const result = await executor.executeCommand(command, {
                timeout: 45000,
                onStream: (streamData) => {
                    console.log(`🔄 Stream [${streamData.type}]: ${streamData.content.substring(0, 80)}...`);
                }
            });
            
            const duration = Date.now() - startTime;
            
            console.log(`✅ Test ${i + 1} Results:`);
            console.log(`   Success: ${result.success}`);
            console.log(`   Method: ${result.method}`);
            console.log(`   Exit Code: ${result.exitCode}`);
            console.log(`   Duration: ${duration}ms`);
            
            if (result.success) {
                console.log(`   Assistant Response Length: ${result.assistantResponse?.length || 0} chars`);
                console.log(`   Raw Output Length: ${result.rawOutput?.length || 0} chars`);
                
                if (result.assistantResponse) {
                    console.log(`   Assistant Response Preview: ${result.assistantResponse.substring(0, 150)}...`);
                }
            } else {
                console.log(`   Error: ${result.error}`);
                if (result.stderr) {
                    console.log(`   Stderr: ${result.stderr.substring(0, 200)}...`);
                }
            }
            
        } catch (error) {
            console.log(`❌ Test ${i + 1} failed with exception:`);
            console.log(`   Error: ${error.message}`);
        }
        
        console.log('');
        
        // 短暂等待避免过于频繁的请求
        if (i < testCommands.length - 1) {
            console.log('⏳ Waiting 2 seconds before next test...\n');
            await new Promise(resolve => setTimeout(resolve, 2000));
        }
    }
    
    console.log('🏁 All tests completed!');
}

// 运行测试
testSpawnExecutor().catch(error => {
    console.error('❌ Test suite failed:', error.message);
    process.exit(1);
});