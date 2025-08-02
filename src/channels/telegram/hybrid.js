/**
 * Telegram Hybrid Handler
 * 同时支持 Webhook 和轮询模式，根据配置自动选择
 * 如果配置了 TELEGRAM_WEBHOOK_URL 则使用 Webhook 模式
 * 否则使用轮询模式
 */

const TelegramWebhookHandler = require('./webhook-old');
const TelegramPollingHandler = require('./polling');
const Logger = require('../../core/logger');

class TelegramHybridHandler {
    constructor(config = {}) {
        this.config = config;
        this.logger = new Logger('TelegramHybrid');
        this.mode = null; // 'webhook' or 'polling'
        this.handler = null;
        this.isRunning = false;
        
        // 决定使用哪种模式
        this._determineMode();
    }

    _determineMode() {
        // 如果配置了 webhook URL，使用 webhook 模式
        if (this.config.webhookUrl || process.env.TELEGRAM_WEBHOOK_URL) {
            this.mode = 'webhook';
            this.handler = new TelegramWebhookHandler(this.config);
            this.logger.info('🌐 Using Webhook mode for Telegram');
        } else {
            this.mode = 'polling';
            this.handler = new TelegramPollingHandler(this.config);
            this.logger.info('🔄 Using Polling mode for Telegram');
        }
    }

    async start() {
        if (this.isRunning) {
            this.logger.warn('Telegram handler is already running');
            return;
        }

        try {
            if (this.mode === 'webhook') {
                await this._startWebhookMode();
            } else {
                await this._startPollingMode();
            }
            
            this.isRunning = true;
            this.logger.info(`✅ Telegram handler started in ${this.mode} mode`);
        } catch (error) {
            this.logger.error(`Failed to start Telegram handler in ${this.mode} mode:`, error.message);
            throw error;
        }
    }

    async _startWebhookMode() {
        // 设置 webhook
        if (this.config.webhookUrl) {
            try {
                const webhookEndpoint = `${this.config.webhookUrl}/webhook/telegram`;
                this.logger.info(`Setting webhook to: ${webhookEndpoint}`);
                await this.handler.setWebhook(webhookEndpoint);
            } catch (error) {
                this.logger.error('Failed to set webhook:', error.message);
                this.logger.info('You can manually set the webhook using:');
                this.logger.info(`curl -X POST https://api.telegram.org/bot${this.config.botToken}/setWebhook -d "url=${this.config.webhookUrl}/webhook/telegram"`);
            }
        } else {
            this.logger.warn('TELEGRAM_WEBHOOK_URL not set. Please set the webhook manually.');
        }
        
        // 启动 webhook 服务器
        const port = this.config.port || process.env.TELEGRAM_WEBHOOK_PORT || 3001;
        this.handler.start(port);
    }

    async _startPollingMode() {
        // 启动轮询
        await this.handler.start();
    }

    async stop() {
        if (!this.isRunning) {
            return;
        }

        try {
            if (this.mode === 'webhook') {
                // Webhook 模式没有显式的 stop 方法，需要手动处理
                this.logger.info('🛑 Stopping webhook server...');
                // 这里可以添加关闭 Express 服务器的逻辑
            } else {
                await this.handler.stop();
            }
            
            this.isRunning = false;
            this.logger.info(`✅ Telegram handler stopped in ${this.mode} mode`);
        } catch (error) {
            this.logger.error(`Error stopping Telegram handler in ${this.mode} mode:`, error.message);
            throw error;
        }
    }

    // 统一的通知发送接口
    async sendNotification(notification) {
        if (!this.isRunning) {
            this.logger.warn('Telegram handler is not running, cannot send notification');
            return false;
        }

        try {
            if (this.mode === 'polling') {
                // 轮询模式有专门的通知发送方法
                const { sessionId, token } = await this.handler.createNotificationSession(notification);
                const messageText = this._generateNotificationMessage(notification, token);
                const chatId = this.config.groupId || this.config.chatId;
                
                this.logger.debug(`Sending notification - groupId: ${this.config.groupId}, chatId: ${this.config.chatId}, final chatId: ${chatId}`);
                
                if (!chatId) {
                    this.logger.error('No valid chatId found in config. Please set TELEGRAM_CHAT_ID or TELEGRAM_GROUP_ID in .env file');
                    return false;
                }
                
                return await this.handler.sendNotificationMessage(chatId, messageText, token, sessionId);
            } else {
                // Webhook 模式需要实现通知发送逻辑
                return await this._sendWebhookNotification(notification);
            }
        } catch (error) {
            this.logger.error('Failed to send notification:', error.message);
            return false;
        }
    }

    _generateNotificationMessage(notification, token) {
        const type = notification.type;
        const emoji = type === 'completed' ? '✅' : '⏳';
        const status = type === 'completed' ? 'Completed' : 'Waiting for Input';
        
        let messageText = `${emoji} *Claude Task ${status}*\n`;
        messageText += `*Project*: ${this._escapeMarkdownV2(notification.project)}\n`;
        messageText += `*Session Token*: \`${token}\`\n\n`;
        
        if (notification.metadata) {
            if (notification.metadata.userQuestion) {
                messageText += `📝 *Your Question*:\n${this._escapeMarkdownV2(notification.metadata.userQuestion.substring(0, 200))}`;
                if (notification.metadata.userQuestion.length > 200) {
                    messageText += '\\.\\.\\.';
                }
                messageText += '\n\n';
            }
            
            if (notification.metadata.claudeResponse) {
                messageText += `🤖 *Claude Response*:\n${this._escapeMarkdownV2(notification.metadata.claudeResponse.substring(0, 300))}`;
                if (notification.metadata.claudeResponse.length > 300) {
                    messageText += '\\.\\.\\.';
                }
                messageText += '\n\n';
            }
        }
        
        messageText += `💬 *To send a command*:\n`;
        messageText += `• Reply to this message directly\n`;
        messageText += `• Send: \`${token} <your command>\`\n`;
        messageText += `• Send: \`/cmd ${token} <your command>\`\n\n`;
        messageText += `💡 *Easiest way*: Just reply to this message\\!`;

        return messageText;
    }

    _escapeMarkdownV2(text) {
        if (!text) return '';
        // Escape all special characters for MarkdownV2
        return text.replace(/[\\._*\\[\\]()~`>#+=|{}.!-]/g, '\\\\$&');
    }

    async _sendWebhookNotification(notification) {
        // 为 webhook 模式实现通知发送
        const token = this._generateToken();
        const messageText = this._generateNotificationMessage(notification, token);
        const chatId = this.config.groupId || this.config.chatId;
        
        try {
            // 使用 webhook 处理器的发送消息方法
            const response = await this.handler._sendMessage(chatId, messageText, { 
                parse_mode: 'Markdown',
                reply_markup: {
                    inline_keyboard: [[
                        {
                            text: '📝 Reply with Command',
                            callback_data: `session:${token}`
                        }
                    ]]
                }
            });
            
            return response !== false;
        } catch (error) {
            this.logger.error('Failed to send webhook notification:', error.message);
            return false;
        }
    }

    _generateToken() {
        // 生成8位Token（大写字母+数字）
        const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
        let token = '';
        for (let i = 0; i < 8; i++) {
            token += chars.charAt(Math.floor(Math.random() * chars.length));
        }
        return token;
    }

    // 测试连接
    async test() {
        try {
            if (!this.config.botToken) {
                throw new Error('Bot token is required');
            }

            this.logger.info('🔍 Testing Telegram API connection...');
            
            // 测试 bot 连接
            const httpClient = this.handler.httpClient || this.handler._createAxiosInstance();
            const response = await httpClient.get(`/bot${this.config.botToken}/getMe`);
            
            if (!response.data.ok) {
                throw new Error(`Bot token invalid: ${response.data.description}`);
            }
            
            this.logger.info(`✅ Bot connected: @${response.data.result.username} (${response.data.result.first_name})`);
            this.logger.info(`📡 Mode: ${this.mode.toUpperCase()}`);
            
            // 如果没有配置聊天对象，只测试 Bot 连接
            if (!this.config.chatId && !this.config.groupId) {
                this.logger.info('✅ Bot connection validated. Ready to accept private messages.');
                return true;
            }

            // 轮询模式需要先启动才能发送通知
            if (this.mode === 'polling' && !this.handler.isRunning) {
                this.logger.info('🔄 Polling mode: Testing bot connection only (service not started yet)');
                return true;
            }

            // Webhook模式或已启动的轮询模式可以发送测试消息
            if (this.mode === 'webhook' || (this.mode === 'polling' && this.handler.isRunning)) {
                const testNotification = {
                    type: 'completed',
                    title: 'Claude-Code-Remote Test',
                    message: 'This is a test message from Telegram channel.',
                    project: 'Test',
                    metadata: {
                        test: true,
                        timestamp: new Date().toISOString()
                    }
                };

                const result = await this.sendNotification(testNotification);
                return result;
            }
            
            return true;
        } catch (error) {
            this.logger.error('Telegram test failed:', error.message);
            return false;
        }
    }

    // 获取状态
    getStatus() {
        const baseStatus = {
            type: 'telegram',
            mode: this.mode,
            running: this.isRunning,
            configured: !!this.config.botToken,
            botToken: this.config.botToken ? 'configured' : 'not configured',
            chatId: this.config.chatId || 'not configured',
            groupId: this.config.groupId || 'not configured'
        };

        if (this.mode === 'polling' && this.handler.getStatus) {
            return {
                ...baseStatus,
                ...this.handler.getStatus()
            };
        } else if (this.mode === 'webhook') {
            return {
                ...baseStatus,
                webhookUrl: this.config.webhookUrl || 'not configured',
                port: this.config.port || process.env.TELEGRAM_WEBHOOK_PORT || 3001
            };
        }

        return baseStatus;
    }
}

module.exports = TelegramHybridHandler;