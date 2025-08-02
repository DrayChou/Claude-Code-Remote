#!/usr/bin/env node

/**
 * Telegram Smart Service
 * 智能模式：根据配置自动选择 Webhook 或轮询模式
 * 如果配置了 TELEGRAM_WEBHOOK_URL 则使用 Webhook 模式
 * 否则使用轮询模式
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

const logger = new Logger('Telegram-Smart-Service');

// Load configuration
const config = {
    botToken: process.env.TELEGRAM_BOT_TOKEN,
    chatId: process.env.TELEGRAM_CHAT_ID,
    groupId: process.env.TELEGRAM_GROUP_ID,
    whitelist: process.env.TELEGRAM_WHITELIST ? process.env.TELEGRAM_WHITELIST.split(',').map(id => id.trim()) : [],
    pollingInterval: parseInt(process.env.TELEGRAM_POLLING_INTERVAL) || 1000,
    webhookUrl: process.env.TELEGRAM_WEBHOOK_URL,
    port: process.env.TELEGRAM_WEBHOOK_PORT || 3001
};

// Validate configuration
if (!config.botToken) {
    logger.error('TELEGRAM_BOT_TOKEN must be set in .env file');
    process.exit(1);
}

// 创建 Telegram 频道处理器
const telegramChannel = new TelegramChannel(config);

async function start() {
    logger.info('🚀 Starting Telegram smart service...');
    logger.info('📋 Configuration:');
    logger.info(`   - Bot Token: ${config.botToken ? '✅ Configured' : '❌ Missing'}`);
    logger.info(`   - Chat ID: ${config.chatId || 'Not set (dynamic private chat)'}`);
    logger.info(`   - Group ID: ${config.groupId || 'Not set'}`);
    logger.info(`   - Whitelist: ${config.whitelist.length > 0 ? config.whitelist.join(', ') : 'None (using configured IDs)'}`);
    logger.info(`   - Webhook URL: ${config.webhookUrl || 'Not set (will use polling mode)'}`);
    logger.info(`   - Webhook Port: ${config.port}`);
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
        
        // 启动服务
        await telegramChannel.start();
        
        const status = telegramChannel.getStatus();
        logger.info(`🎉 Telegram service started successfully in ${status.mode.toUpperCase()} mode!`);
        
        if (status.mode === 'webhook') {
            logger.info(`🌐 Webhook server running on port ${status.port}`);
            logger.info(`📡 Webhook URL: ${status.webhookUrl || 'Please set TELEGRAM_WEBHOOK_URL'}`);
        } else {
            logger.info('🔄 Polling service is actively checking for new messages.');
        }
        
        logger.info('📱 Send /start to your bot to begin using it.');
        
        // 定期显示状态
        setInterval(() => {
            const currentStatus = telegramChannel.getStatus();
            logger.debug('📊 Service Status:', {
                mode: currentStatus.mode,
                running: currentStatus.running,
                ...(currentStatus.polling && {
                    polling: currentStatus.polling,
                    consecutiveErrors: currentStatus.polling.consecutiveErrors || 0,
                    lastUpdateId: currentStatus.polling.lastUpdateId || 0
                }),
                ...(currentStatus.webhookUrl && {
                    webhookUrl: currentStatus.webhookUrl,
                    port: currentStatus.port
                })
            });
        }, 60000); // 每分钟显示一次状态
        
    } catch (error) {
        logger.error('❌ Failed to start Telegram service:', error.message);
        process.exit(1);
    }
}

start();

// Handle graceful shutdown
process.on('SIGINT', async () => {
    logger.info('🛑 Shutting down Telegram service...');
    try {
        await telegramChannel.stop();
        logger.info('✅ Telegram service stopped gracefully');
        process.exit(0);
    } catch (error) {
        logger.error('Error during shutdown:', error.message);
        process.exit(1);
    }
});

process.on('SIGTERM', async () => {
    logger.info('🛑 Shutting down Telegram service...');
    try {
        await telegramChannel.stop();
        logger.info('✅ Telegram service stopped gracefully');
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