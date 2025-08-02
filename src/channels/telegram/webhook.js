/**
 * Telegram Channel Handler
 * 智能混合模式：支持 Webhook 和轮询
 * 根据配置自动选择最合适的模式
 */

const TelegramHybridHandler = require('./hybrid');
const Logger = require('../../core/logger');

class TelegramChannel {
    constructor(config = {}) {
        this.config = config;
        this.logger = new Logger('TelegramChannel');
        this.hybridHandler = new TelegramHybridHandler(config);
        this.isRunning = false;
    }

    async start() {
        if (this.isRunning) {
            this.logger.warn('Telegram channel is already running');
            return;
        }

        try {
            await this.hybridHandler.start();
            this.isRunning = true;
            const status = this.hybridHandler.getStatus();
            this.logger.info(`✅ Telegram channel started in ${status.mode} mode`);
        } catch (error) {
            this.logger.error('Failed to start Telegram channel:', error.message);
            throw error;
        }
    }

    async stop() {
        if (!this.isRunning) {
            return;
        }

        try {
            await this.hybridHandler.stop();
            this.isRunning = false;
            this.logger.info('✅ Telegram channel stopped');
        } catch (error) {
            this.logger.error('Error stopping Telegram channel:', error.message);
            throw error;
        }
    }

    // 发送通知的主要方法
    async sendNotification(notification) {
        if (!this.isRunning) {
            this.logger.warn('Telegram channel is not running, cannot send notification');
            return false;
        }

        try {
            const success = await this.hybridHandler.sendNotification(notification);
            if (success) {
                const chatId = this.config.groupId || this.config.chatId || 'dynamic';
                this.logger.info(`Notification sent successfully to ${chatId}`);
                return true;
            }
            return false;
        } catch (error) {
            this.logger.error('Failed to send notification:', error.message);
            return false;
        }
    }

    // 测试连接
    async test() {
        try {
            if (!this.config.botToken) {
                throw new Error('Bot token is required');
            }

            this.logger.info('🔍 Testing Telegram API connection...');
            
            const result = await this.hybridHandler.test();
            return result;
        } catch (error) {
            this.logger.error('Telegram test failed:', error.message);
            return false;
        }
    }

    // 获取状态
    getStatus() {
        return this.hybridHandler.getStatus();
    }
}

module.exports = TelegramChannel;