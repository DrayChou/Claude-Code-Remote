#!/usr/bin/env node

/**
 * Quick test with longer timeout to confirm the implementation works
 */

const { executeClaudeCommand } = require('./claude-executor');

async function quickTest() {
    console.log('🧪 Quick test with extended timeout...\n');
    
    try {
        const result = await executeClaudeCommand('Say "Hello World" in one sentence.', {
            timeout: 120000, // 2 minutes
            onStream: (chunk) => {
                console.log(`🔄 [${chunk.type}]: ${chunk.type === 'assistant' ? chunk.content.substring(0, 50) + '...' : chunk.subtype}`);
            }
        });
        
        console.log('\n✅ Final Results:');
        console.log(`   Success: ${result.success}`);
        console.log(`   Duration: ${result.duration}ms`);
        console.log(`   JSON Chunks: ${result.jsonChunks.length}`);
        console.log(`   Assistant Response: ${result.assistantResponse.length} chars`);
        console.log(`   Complete: ${result.isComplete}`);
        
        if (result.assistantResponse) {
            console.log(`\n📝 Claude's Response: ${result.assistantResponse}`);
        }
        
    } catch (error) {
        console.error('❌ Test failed:', error.message);
    }
}

quickTest();