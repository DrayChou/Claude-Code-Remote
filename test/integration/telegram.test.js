#!/usr/bin/env node

/**
 * Telegram Integration Tests
 * 整合了所有 Telegram 相关的测试功能
 */

const path = require('path');
const fs = require('fs');

// 手动加载环境变量
const envPath = path.join(__dirname, '../../.env');
if (fs.existsSync(envPath)) {
    const envContent = fs.readFileSync(envPath, 'utf8');
    envContent.split('\n').forEach(line => {
        const [key, ...values] = line.split('=');
        if (key && values.length > 0 && !process.env[key]) {
            process.env[key] = values.join('=');
        }
    });
}

const Logger = require('../../src/core/logger');
const ConfigManager = require('../../src/core/config');

class TelegramTestSuite {
    constructor() {
        this.logger = new Logger('TelegramTest');
        this.results = {
            passed: 0,
            failed: 0,
            tests: []
        };
    }

    async runTest(name, testFn) {
        console.log(`\n📋 Running: ${name}...`);
        try {
            await testFn();
            console.log(`✅ ${name} - PASSED`);
            this.results.passed++;
            this.results.tests.push({ name, status: 'PASSED' });
        } catch (error) {
            console.log(`❌ ${name} - FAILED: ${error.message}`);
            this.results.failed++;
            this.results.tests.push({ name, status: 'FAILED', error: error.message });
        }
    }

    async runAll() {
        console.log('🧪 Telegram Integration Test Suite');
        console.log('===================================\n');

        // Test 1: Setup Check
        await this.runTest('Setup Verification', async () => {
            await this.testSetup();
        });

        // Test 2: Configuration Loading
        await this.runTest('Configuration Loading', async () => {
            await this.testConfiguration();
        });

        // Test 3: Environment Variables
        await this.runTest('Environment Variables', async () => {
            await this.testEnvironmentVariables();
        });

        // Test 4: Channel Creation
        await this.runTest('Channel Creation', async () => {
            await this.testChannelCreation();
        });

        // Test 5: Bot Connection (if configured)
        if (process.env.TELEGRAM_BOT_TOKEN) {
            await this.runTest('Bot Connection', async () => {
                await this.testBotConnection();
            });

            // Test 6: Message Sending (if configured)
            if (process.env.TELEGRAM_CHAT_ID || process.env.TELEGRAM_GROUP_ID) {
                await this.runTest('Message Sending', async () => {
                    await this.testMessageSending();
                });
            }
        }

        // Test 7: Session Management
        await this.runTest('Session Management', async () => {
            await this.testSessionManagement();
        });

        this.printResults();
    }

    async testSetup() {
        // 检查文件存在
        const requiredFiles = [
            '../../src/channels/chat/telegram.js',
            '../../config/channels.json',
            '../../src/core/notifier.js'
        ];

        for (const file of requiredFiles) {
            const fullPath = path.join(__dirname, file);
            if (!fs.existsSync(fullPath)) {
                throw new Error(`Required file not found: ${file}`);
            }
        }

        // 检查 Telegram 频道类是否可以加载
        const TelegramChannel = require('../../src/channels/chat/telegram');
        if (typeof TelegramChannel !== 'function') {
            throw new Error('TelegramChannel is not a constructor function');
        }
    }

    async testConfiguration() {
        const config = new ConfigManager();
        config.load();
        
        const telegramConfig = config.getChannel('telegram');
        if (!telegramConfig) {
            throw new Error('Telegram configuration not found');
        }

        if (telegramConfig.type !== 'chat') {
            throw new Error('Telegram type should be "chat"');
        }

        if (!telegramConfig.hasOwnProperty('enabled')) {
            throw new Error('Telegram config missing "enabled" property');
        }
    }

    async testEnvironmentVariables() {
        const requiredEnvVars = ['TELEGRAM_BOT_TOKEN'];
        const optionalEnvVars = ['TELEGRAM_CHAT_ID', 'TELEGRAM_GROUP_ID', 'TELEGRAM_WHITELIST'];

        // 检查至少有一个聊天目标
        const hasChatTarget = process.env.TELEGRAM_CHAT_ID || process.env.TELEGRAM_GROUP_ID;
        if (process.env.TELEGRAM_BOT_TOKEN && !hasChatTarget) {
            console.log('⚠️  Warning: Bot token configured but no chat target (TELEGRAM_CHAT_ID or TELEGRAM_GROUP_ID)');
        }

        console.log('Environment variables status:');
        requiredEnvVars.forEach(env => {
            console.log(`   ${env}: ${process.env[env] ? '✅ configured' : '❌ not set'}`);
        });
        optionalEnvVars.forEach(env => {
            console.log(`   ${env}: ${process.env[env] ? '✅ configured' : '⚠️  not set'}`);
        });
    }

    async testChannelCreation() {
        const TelegramChannel = require('../../src/channels/chat/telegram');
        
        // 测试用环境变量创建
        const channel1 = new TelegramChannel({});
        if (!channel1) {
            throw new Error('Failed to create channel with environment variables');
        }

        // 测试用配置对象创建
        const channel2 = new TelegramChannel({
            botToken: 'test-token',
            chatId: '123456789'
        });
        if (!channel2) {
            throw new Error('Failed to create channel with config object');
        }

        // 测试能力定义
        const capabilities = channel2.capabilities;
        if (!capabilities.canSend || !capabilities.canReceive || !capabilities.supportsRelay) {
            throw new Error('Channel capabilities not properly defined');
        }
    }

    async testBotConnection() {
        const TelegramChannel = require('../../src/channels/chat/telegram');
        const channel = new TelegramChannel({});
        
        if (!channel.validateConfig()) {
            throw new Error('Channel configuration is invalid');
        }

        // 测试 Bot API 连接
        const response = await fetch(`https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/getMe`);
        const result = await response.json();
        
        if (!result.ok) {
            throw new Error(`Bot connection failed: ${result.description}`);
        }

        console.log(`   Bot info: ${result.result.first_name} (@${result.result.username})`);
    }

    async testMessageSending() {
        const TelegramChannel = require('../../src/channels/chat/telegram');
        const channel = new TelegramChannel({});
        
        const testNotification = {
            type: 'completed',
            title: 'Test Suite Message',
            message: 'This is a test message from the automated test suite.',
            project: 'TestSuite',
            metadata: {
                test: true,
                timestamp: new Date().toISOString(),
                userQuestion: 'Test integration working?',
                claudeResponse: 'Yes, Telegram integration test passed!'
            }
        };

        const result = await channel._sendImpl(testNotification);
        if (!result) {
            throw new Error('Failed to send test message');
        }

        console.log('   ✅ Test message sent successfully');
    }

    async testSessionManagement() {
        const sessionsDir = path.join(__dirname, '../../src/data/sessions');
        if (!fs.existsSync(sessionsDir)) {
            fs.mkdirSync(sessionsDir, { recursive: true });
        }

        const sessionFiles = fs.readdirSync(sessionsDir).filter(f => f.endsWith('.json'));
        console.log(`   Session files: ${sessionFiles.length}`);

        if (sessionFiles.length > 0) {
            const latestSession = sessionFiles[sessionFiles.length - 1];
            const sessionPath = path.join(sessionsDir, latestSession);
            const session = JSON.parse(fs.readFileSync(sessionPath, 'utf8'));
            
            if (!session.id || !session.token || !session.origin) {
                throw new Error('Session structure incomplete');
            }
            
            console.log(`   Latest session origin: ${session.origin}`);
        }
    }

    printResults() {
        console.log('\n📊 Test Results Summary');
        console.log('======================');
        console.log(`✅ Passed: ${this.results.passed}`);
        console.log(`❌ Failed: ${this.results.failed}`);
        console.log(`📋 Total: ${this.results.tests.length}`);

        if (this.results.failed > 0) {
            console.log('\n❌ Failed Tests:');
            this.results.tests.filter(t => t.status === 'FAILED').forEach(test => {
                console.log(`   - ${test.name}: ${test.error}`);
            });
        }

        if (this.results.failed === 0) {
            console.log('\n🎉 All tests passed! Telegram integration is ready.');
        } else {
            console.log('\n⚠️  Some tests failed. Please check the configuration.');
        }

        console.log('\n💡 Next steps:');
        console.log('1. Configure Telegram: node src/config-manager.js');
        console.log('2. Start multi-channel service: npm start');
        console.log('3. Test real notifications: node claude-remote.js test');
    }
}

// 运行测试
if (require.main === module) {
    const suite = new TelegramTestSuite();
    suite.runAll().catch(console.error);
}

module.exports = TelegramTestSuite;