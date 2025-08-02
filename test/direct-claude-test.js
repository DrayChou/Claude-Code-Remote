#!/usr/bin/env node

/**
 * Direct Claude Headless Executor Test
 * Tests the ClaudeHeadlessExecutor directly with GLM 4.5 CLI
 */

require('dotenv').config();
const path = require('path');
const ClaudeHeadlessExecutor = require('../src/relay/claude-headless-executor');
const Logger = require('../src/core/logger');

async function testClaudeExecutor() {
    console.log('🧪 Testing Claude Headless Executor directly...\n');
    
    const logger = new Logger('TestExecutor');
    const executor = new ClaudeHeadlessExecutor(logger);
    
    // Show configuration
    console.log('📋 Configuration:');
    console.log(`   Platform: ${executor.platform}`);
    console.log(`   Is Windows: ${executor.isWindows}`);
    console.log(`   Claude Path: ${executor.claudePath}`);
    console.log('');
    
    // Test command
    const testCommand = "test";
    console.log(`📝 Test command: "${testCommand}"`);
    console.log('');
    
    try {
        console.log('⏳ Executing command...');
        const result = await executor.executeCommand(testCommand, {
            timeout: 120000, // 2 minutes
            verbose: true
        });
        
        console.log('\n📊 Execution Result:');
        console.log(`   Success: ${result.success}`);
        console.log(`   Method: ${result.method}`);
        console.log(`   Duration: ${result.duration}ms`);
        
        if (result.success) {
            console.log('\n✅ Command executed successfully!');
            console.log('\n🤖 Claude Response:');
            console.log('----------------');
            console.log(result.assistantResponse || result.output || 'No response');
            console.log('----------------');
        } else {
            console.log('\n❌ Command failed:');
            console.log(`   Error: ${result.error}`);
            console.log(`   Message: ${result.message}`);
            if (result.stderr) {
                console.log(`   Stderr: ${result.stderr}`);
            }
        }
        
    } catch (error) {
        console.error('\n💥 Test failed:', error.message);
    }
}

// Run the test
testClaudeExecutor().catch(console.error);