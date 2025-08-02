#!/usr/bin/env node

/**
 * Stop all running Telegram bot services
 * This script helps resolve conflicts when multiple bot instances are running
 */

const { execSync, spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

console.log('🛑 Stopping all Telegram bot services...\n');

// Function to kill processes by name pattern
function killProcessesByPattern(pattern, description) {
    try {
        console.log(`Looking for ${description}...`);
        
        // On Windows, use taskkill with pattern matching
        if (process.platform === 'win32') {
            try {
                const tasklist = execSync('tasklist /FO CSV', { encoding: 'utf8' });
                const lines = tasklist.split('\n');
                const processIds = [];
                
                lines.forEach(line => {
                    if (line.includes('node.exe')) {
                        const match = line.match(/"(\d+)"/g);
                        if (match && match[1]) {
                            const pid = match[1].replace(/"/g, '');
                            processIds.push(pid);
                        }
                    }
                });
                
                if (processIds.length > 0) {
                    console.log(`Found ${processIds.length} Node.js processes`);
                    
                    // Try to gracefully kill each process
                    processIds.forEach(pid => {
                        try {
                            execSync(`taskkill /PID ${pid} /T /F`, { stdio: 'ignore' });
                            console.log(`✅ Killed process ${pid}`);
                        } catch (error) {
                            // Process might already be dead
                            console.log(`⚠️  Process ${pid} already terminated`);
                        }
                    });
                }
            } catch (error) {
                console.log(`No ${description} found`);
            }
        } else {
            // Unix-like systems
            try {
                execSync(`pkill -f "${pattern}"`, { stdio: 'ignore' });
                console.log(`✅ Stopped ${description}`);
            } catch (error) {
                console.log(`No ${description} found`);
            }
        }
    } catch (error) {
        console.log(`⚠️  Error stopping ${description}:`, error.message);
    }
}

// Clear any webhook conflicts by calling Telegram API
async function clearTelegramWebhook() {
    console.log('\n🧹 Clearing Telegram webhook conflicts...');
    
    const envPath = path.join(__dirname, '.env');
    if (fs.existsSync(envPath)) {
        require('dotenv').config({ path: envPath });
        
        const botToken = process.env.TELEGRAM_BOT_TOKEN;
        if (botToken) {
            try {
                const https = require('https');
                const axios = require('axios');
                
                // Delete webhook to stop any webhook conflicts
                await axios.post(`https://api.telegram.org/bot${botToken}/deleteWebhook`);
                console.log('✅ Webhook cleared');
                
                // Clear pending updates
                await axios.get(`https://api.telegram.org/bot${botToken}/getUpdates?offset=-1`);
                console.log('✅ Pending updates cleared');
                
            } catch (error) {
                console.log('⚠️  Could not clear webhook:', error.message);
            }
        }
    }
}

async function main() {
    // Kill all node processes (nuclear option for Windows)
    killProcessesByPattern('node', 'Node.js processes');
    
    // Wait a moment for processes to terminate
    await new Promise(resolve => setTimeout(resolve, 2000));
    
    // Clear Telegram webhook conflicts
    await clearTelegramWebhook();
    
    console.log('\n✅ Cleanup completed!');
    console.log('📱 You can now start the Telegram service again:');
    console.log('   npm run telegram');
    console.log('   or');
    console.log('   node start-telegram-smart.js');
    
    process.exit(0);
}

main().catch(error => {
    console.error('❌ Cleanup failed:', error.message);
    process.exit(1);
});