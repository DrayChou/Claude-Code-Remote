#!/usr/bin/env node

/**
 * Telegram Polling Service
 * Starts the Telegram polling service for actively checking messages
 * 替代 webhook 模式，使用主动轮询获取消息
 */

const path = require('path');
const fs = require('fs');
const dotenv = require('dotenv');
const Logger = require('./src/core/logger');
const TelegramChannel = require('./src/channels/telegram/webhook');

// Load environment variables
const envPath = path.join(__dirname, '.env');
if (fs.existsSync(envPath)) {
    dotenv.config({ path: envPath });
}

const logger = new Logger('Telegram-Polling-Service');

// Load configuration
const config = {
    botToken: process.env.TELEGRAM_BOT_TOKEN,
    chatId: process.env.TELEGRAM_CHAT_ID,
    groupId: process.env.TELEGRAM_GROUP_ID,
    whitelist: process.env.TELEGRAM_WHITELIST ? process.env.TELEGRAM_WHITELIST.split(',').map(id => id.trim()) : [],
    pollingInterval: parseInt(process.env.TELEGRAM_POLLING_INTERVAL) || 1000
};

// Validate configuration
if (!config.botToken) {
    logger.error('TELEGRAM_BOT_TOKEN must be set in .env file');
    process.exit(1);
}

// 创建 Telegram 频道处理器
const telegramChannel = new TelegramChannel(config);

async function start() {
    logger.info('🚀 Starting Telegram polling service...');
    logger.info('📋 Configuration:');
    logger.info(`   - Bot Token: ${config.botToken ? '✅ Configured' : '❌ Missing'}`);
    logger.info(`   - Chat ID: ${config.chatId || 'Not set (dynamic private chat)'}`);
    logger.info(`   - Group ID: ${config.groupId || 'Not set'}`);
    logger.info(`   - Whitelist: ${config.whitelist.length > 0 ? config.whitelist.join(', ') : 'None (using configured IDs)'}`);
    logger.info(`   - Polling Interval: ${config.pollingInterval}ms`);
    logger.info(`   - Proxy: ${process.env.HTTP_PROXY || process.env.http_proxy || 'Not configured'}`);
    
    try {
        // 测试连接
        logger.info('🔍 Testing Telegram API connection...');
        const testResult = await telegramChannel.test();
        
        if (!testResult) {
            logger.error('❌ Telegram API test failed. Please check your configuration and network connection.');
            process.exit(1);
        }
        
        logger.info('✅ Telegram API test passed');
        
        // 启动轮询服务
        await telegramChannel.start();
        
        logger.info('🎉 Telegram polling service started successfully!');
        logger.info('💡 The service is now actively checking for new messages.');
        logger.info('📱 Send /start to your bot to begin using it.');
        
        // 定期显示状态
        setInterval(() => {
            const status = telegramChannel.getStatus();
            logger.debug('📊 Service Status:', {
                running: status.running,
                polling: status.polling,
                consecutiveErrors: status.polling?.consecutiveErrors || 0,
                lastUpdateId: status.polling?.lastUpdateId || 0
            });
        }, 60000); // 每分钟显示一次状态
        
    } catch (error) {
        logger.error('❌ Failed to start Telegram polling service:', error.message);
        process.exit(1);
    }
}

start();

// Handle graceful shutdown
process.on('SIGINT', async () => {
    logger.info('🛑 Shutting down Telegram polling service...');
    try {
        await telegramChannel.stop();
        logger.info('✅ Telegram polling service stopped gracefully');
        process.exit(0);
    } catch (error) {
        logger.error('Error during shutdown:', error.message);
        process.exit(1);
    }
});

process.on('SIGTERM', async () => {
    logger.info('🛑 Shutting down Telegram polling service...');
    try {
        await telegramChannel.stop();
        logger.info('✅ Telegram polling service stopped gracefully');
        process.exit(0);
    } catch (error) {
        logger.error('Error during shutdown:', error.message);
        process.exit(1);
    }
});

// Handle uncaught exceptions
process.on('uncaughtException', (error) => {
    logger.error('💥 Uncaught Exception:', error);
    process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
    logger.error('💥 Unhandled Rejection at:', promise, 'reason:', reason);
    process.exit(1);
});