#!/usr/bin/env node

/**
 * Test the actual tmux-injector implementation
 */

require('dotenv').config();

console.log('🚀 TESTING TMUX INJECTOR');
console.log('========================\n');

const TmuxInjector = require('./src/relay/tmux-injector');

// Create a simple logger
const logger = {
    info: (msg) => console.log(`ℹ️  ${msg}`),
    debug: (msg) => console.log(`🔍 ${msg}`),
    warn: (msg) => console.log(`⚠️  ${msg}`),
    error: (msg) => console.log(`❌ ${msg}`)
};

async function testTmuxInjector() {
    console.log('📋 Testing tmux injector with simple command...');
    
    const injector = new TmuxInjector(logger);
    
    try {
        // Test with a simple echo command
        const result = await injector.injectCommand('test-session', 'echo "Hello from Telegram"');
        
        console.log('✅ Injection result:');
        console.log(JSON.stringify(result, null, 2));
        
        return result;
    } catch (error) {
        console.error('❌ Test failed:', error.message);
        return { success: false, error: error.message };
    }
}

testTmuxInjector().then((result) => {
    console.log('\n🎯 Test completed');
    if (result.success) {
        console.log('✅ Tmux injector is working correctly');
    } else {
        console.log('❌ Tmux injector needs attention');
    }
}).catch(console.error);