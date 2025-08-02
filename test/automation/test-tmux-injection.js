#!/usr/bin/env node

/**
 * Test script to verify tmux injection functionality
 * This script tests whether tmux injection is working properly
 */

const path = require('path');
const fs = require('fs');

// Load environment variables
require('dotenv').config();

console.log('🧪 TESTING TMUX INJECTION FUNCTIONALITY');
console.log('=======================================\n');

// Check if tmux is available
const { execSync } = require('child_process');

function checkTmuxAvailability() {
    console.log('🔍 Checking tmux availability...');
    
    try {
        const result = execSync('tmux -V', { 
            encoding: 'utf8',
            stdio: ['ignore', 'pipe', 'ignore']
        }).trim();
        console.log(`✅ tmux is available: ${result}`);
        return true;
    } catch (error) {
        console.log('❌ tmux is not available or not in PATH');
        return false;
    }
}

function getCurrentTmuxSession() {
    console.log('🔍 Checking current tmux session...');
    
    try {
        const tmuxSession = execSync('tmux display-message -p "#S"', { 
            encoding: 'utf8',
            stdio: ['ignore', 'pipe', 'ignore']
        }).trim();
        console.log(`✅ Current tmux session: ${tmuxSession}`);
        return tmuxSession;
    } catch (error) {
        console.log('❌ Not currently in a tmux session');
        return null;
    }
}

function listTmuxSessions() {
    console.log('🔍 Listing existing tmux sessions...');
    
    try {
        const sessions = execSync('tmux list-sessions', { 
            encoding: 'utf8',
            stdio: ['ignore', 'pipe', 'ignore']
        }).trim();
        console.log(`✅ Available tmux sessions:\n${sessions}`);
        return sessions;
    } catch (error) {
        console.log('❌ No tmux sessions found');
        return null;
    }
}

function createTestSession() {
    console.log('🔧 Creating test tmux session...');
    
    try {
        const sessionName = 'claude-test-' + Date.now();
        execSync(`tmux new-session -d -s ${sessionName}`, { 
            encoding: 'utf8',
            stdio: ['ignore', 'pipe', 'ignore']
        });
        console.log(`✅ Created test session: ${sessionName}`);
        return sessionName;
    } catch (error) {
        console.log(`❌ Failed to create test session: ${error.message}`);
        return null;
    }
}

function testCommandInjection(sessionName) {
    console.log(`🧪 Testing command injection in session: ${sessionName}`);
    
    try {
        // Test simple command injection
        const testCommand = 'echo "Hello from tmux injection!"';
        const injectCommand = `tmux send-keys -t ${sessionName} '${testCommand}' Enter`;
        
        execSync(injectCommand, { 
            encoding: 'utf8',
            stdio: ['ignore', 'pipe', 'ignore']
        });
        
        console.log(`✅ Command injected successfully: ${testCommand}`);
        
        // Wait a moment and capture the output
        setTimeout(() => {
            try {
                const captureCommand = `tmux capture-pane -p -t ${sessionName}`;
                const output = execSync(captureCommand, { 
                    encoding: 'utf8',
                    stdio: ['ignore', 'pipe', 'ignore']
                }).trim();
                
                console.log('📋 Captured output:');
                console.log(output);
                
                // Check if our test message is in the output
                if (output.includes('Hello from tmux injection!')) {
                    console.log('✅ Test message found in output - injection working!');
                } else {
                    console.log('⚠️  Test message not found in output');
                }
            } catch (error) {
                console.log(`❌ Failed to capture output: ${error.message}`);
            }
        }, 1000);
        
        return true;
    } catch (error) {
        console.log(`❌ Command injection failed: ${error.message}`);
        return false;
    }
}

function testClaudeCommand(sessionName) {
    console.log(`🧪 Testing Claude command in session: ${sessionName}`);
    
    try {
        // Test Claude command
        const claudeCommand = 'claude --version';
        const injectCommand = `tmux send-keys -t ${sessionName} '${claudeCommand}' Enter`;
        
        execSync(injectCommand, { 
            encoding: 'utf8',
            stdio: ['ignore', 'pipe', 'ignore']
        });
        
        console.log(`✅ Claude command injected: ${claudeCommand}`);
        
        // Wait longer for Claude to respond
        setTimeout(() => {
            try {
                const captureCommand = `tmux capture-pane -p -t ${sessionName}`;
                const output = execSync(captureCommand, { 
                    encoding: 'utf8',
                    stdio: ['ignore', 'pipe', 'ignore']
                }).trim();
                
                console.log('📋 Claude command output:');
                console.log(output);
            } catch (error) {
                console.log(`❌ Failed to capture Claude output: ${error.message}`);
            }
        }, 3000);
        
        return true;
    } catch (error) {
        console.log(`❌ Claude command injection failed: ${error.message}`);
        return false;
    }
}

function cleanupTestSession(sessionName) {
    console.log(`🧹 Cleaning up test session: ${sessionName}`);
    
    try {
        execSync(`tmux kill-session -t ${sessionName}`, { 
            encoding: 'utf8',
            stdio: ['ignore', 'pipe', 'ignore']
        });
        console.log(`✅ Test session cleaned up: ${sessionName}`);
    } catch (error) {
        console.log(`❌ Failed to cleanup test session: ${error.message}`);
    }
}

async function runTmuxTests() {
    console.log('🚀 Starting tmux injection tests...\n');
    
    // Step 1: Check tmux availability
    const tmuxAvailable = checkTmuxAvailability();
    if (!tmuxAvailable) {
        console.log('❌ tmux not available - cannot run injection tests');
        return;
    }
    
    // Step 2: Check current session
    const currentSession = getCurrentTmuxSession();
    if (currentSession) {
        console.log('✅ Already in tmux session - can test injection directly');
        
        // Test command injection in current session
        testCommandInjection(currentSession);
        
        // Test Claude command
        testClaudeCommand(currentSession);
        
        console.log('\n🎯 Testing in current session complete');
        console.log('💡 Check the output above to see if injection is working');
        return;
    }
    
    // Step 3: List existing sessions
    const existingSessions = listTmuxSessions();
    if (existingSessions) {
        console.log('💡 Found existing tmux sessions - you can test with one of these');
        console.log('   To test injection, run this script from within one of these sessions');
        return;
    }
    
    // Step 4: Create test session
    console.log('🔧 No existing sessions found - creating test session...');
    const testSession = createTestSession();
    if (!testSession) {
        console.log('❌ Failed to create test session');
        return;
    }
    
    // Step 5: Test injection in new session
    testCommandInjection(testSession);
    
    // Step 6: Test Claude command
    testClaudeCommand(testSession);
    
    // Step 7: Cleanup
    setTimeout(() => {
        cleanupTestSession(testSession);
        console.log('\n🎯 Tmux injection tests complete');
    }, 5000);
}

// Run the tests
runTmuxTests().catch(console.error);