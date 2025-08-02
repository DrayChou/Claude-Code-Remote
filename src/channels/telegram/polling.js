/**
 * Telegram Polling Handler
 * 主动轮询 Telegram 消息替代被动 webhook 模式
 * 支持 HTTP_PROXY 配置和完整的错误处理机制
 */

const axios = require('axios');
const path = require('path');
const fs = require('fs');
const Logger = require('../../core/logger');
const ControllerInjector = require('../../utils/controller-injector');

class TelegramPollingHandler {
    constructor(config = {}) {
        this.config = config;
        this.logger = new Logger('TelegramPolling');
        this.sessionsDir = path.join(__dirname, '../../data/sessions');
        this.injector = new ControllerInjector();
        this.apiBaseUrl = 'https://api.telegram.org';
        this.botUsername = null;
        
        // 轮询配置
        this.pollingInterval = config.pollingInterval || 1000;
        this.lastUpdateId = 0;
        this.isPolling = false;
        this.currentPolling = false;
        
        // 错误处理和重试
        this.consecutiveErrors = 0;
        this.maxConsecutiveErrors = 5;
        this.backoffMultiplier = 2;
        this.maxBackoffInterval = 60000;
        
        // Token 管理
        this.activeTokens = new Map(); // chatId -> {token, timestamp, messageId}
        this.tokenMessageMap = new Map(); // messageId -> {token, sessionId}
        
        // 代理配置
        this.proxyConfig = this._setupProxy();
        this.httpClient = this._createAxiosInstance();
        
        this._ensureDirectories();
    }

    _ensureDirectories() {
        if (!fs.existsSync(this.sessionsDir)) {
            fs.mkdirSync(this.sessionsDir, { recursive: true });
        }
    }

    _setupProxy() {
        // 支持 HTTP_PROXY 和 http_proxy 环境变量
        const proxyUrl = process.env.HTTP_PROXY || process.env.http_proxy;
        
        if (proxyUrl) {
            // 隐藏用户名密码的显示版本
            const displayUrl = proxyUrl.replace(/\/\/([^:]+):([^@]+)@/, '//***:***@');
            this.logger.info(`🌐 Using proxy for Telegram API: ${displayUrl}`);
            
            try {
                const url = new URL(proxyUrl);
                const config = {
                    host: url.hostname,
                    port: parseInt(url.port) || (url.protocol === 'https:' ? 443 : 80),
                    protocol: url.protocol.replace(':', '')
                };
                
                // 添加认证信息（如果有）
                if (url.username && url.password) {
                    config.auth = {
                        username: decodeURIComponent(url.username),
                        password: decodeURIComponent(url.password)
                    };
                }
                
                return config;
            } catch (error) {
                this.logger.error(`❌ Invalid proxy URL: ${proxyUrl}`, error.message);
                return null;
            }
        }
        
        return null;
    }

    _createAxiosInstance() {
        const config = {
            baseURL: this.apiBaseUrl,
            timeout: 60000,
            headers: {
                'Content-Type': 'application/json'
            }
        };

        // 添加代理配置
        if (this.proxyConfig) {
            config.proxy = this.proxyConfig;
            
            // 当使用代理时，设置更宽松的SSL选项
            const https = require('https');
            config.httpsAgent = new https.Agent({
                rejectUnauthorized: false,
                secureProtocol: 'TLS_method',
                ciphers: 'ALL',
                honorCipherOrder: false,
                minVersion: 'TLSv1'
            });
            
            // 忽略所有SSL错误
            process.env["NODE_TLS_REJECT_UNAUTHORIZED"] = 0;
            
            this.logger.debug('🔓 SSL certificate verification disabled for proxy connection');
        }

        return axios.create(config);
    }

    _handleNetworkError(error) {
        if (error.code === 'ENOTFOUND' || error.code === 'ECONNREFUSED' || error.code === 'ETIMEDOUT') {
            if (this.proxyConfig) {
                return `Network error: Cannot reach Telegram API via proxy ${this.proxyConfig.host}:${this.proxyConfig.port}. Check proxy settings.`;
            } else {
                return `Network error: Cannot reach Telegram API. Check your network connection or configure a proxy.`;
            }
        } else if (error.code === 'ECONNRESET' || error.code === 'EPIPE') {
            return `Connection error: Connection to Telegram API was reset.`;
        } else if (error.code === 'CERT_HAS_EXPIRED' || error.code === 'UNABLE_TO_VERIFY_LEAF_SIGNATURE') {
            return `SSL error: Certificate verification failed. This may happen with some proxies.`;
        }
        return error.message;
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

    _isAuthorized(userId, chatId, chatType) {
        // 检查白名单
        const whitelist = this.config.whitelist || [];
        
        if (whitelist.includes(String(chatId)) || whitelist.includes(String(userId))) {
            return true;
        }
        
        // 如果没有白名单配置，允许配置的聊天对象
        if (whitelist.length === 0) {
            const configuredChatId = this.config.chatId || this.config.groupId;
            if (configuredChatId && String(chatId) === String(configuredChatId)) {
                return true;
            }
            
            // 如果只配置了 Bot Token，支持私聊
            if (!configuredChatId && chatType === 'private') {
                this.logger.info(`🔓 Dynamic private chat authorized: ${userId} (${chatId})`);
                return true;
            }
        }
        
        return false;
    }

    async _getBotUsername() {
        if (this.botUsername) {
            return this.botUsername;
        }

        try {
            const response = await this.httpClient.get(`/bot${this.config.botToken}/getMe`);
            
            if (response.data.ok && response.data.result.username) {
                this.botUsername = response.data.result.username;
                return this.botUsername;
            }
        } catch (error) {
            this.logger.error('Failed to get bot username:', error.message);
        }
        
        // 回退到配置的用户名或默认值
        return this.config.botUsername || 'claude_remote_bot';
    }

    async _sendMessage(chatId, text, options = {}) {
        try {
            const response = await this.httpClient.post(`/bot${this.config.botToken}/sendMessage`, {
                chat_id: chatId,
                text: text,
                ...options
            });
            
            if (response.status === 200 && response.data.ok) {
                return response.data.result;
            } else {
                return false;
            }
        } catch (error) {
            this.logger.error('Failed to send message:', error.message);
            return false;
        }
    }

    async _findSessionByToken(token) {
        try {
            const sessionFiles = fs.readdirSync(this.sessionsDir).filter(f => f.endsWith('.json'));
            
            for (const file of sessionFiles) {
                const sessionPath = path.join(this.sessionsDir, file);
                try {
                    const session = JSON.parse(fs.readFileSync(sessionPath, 'utf8'));
                    if (session.token === token) {
                        return session;
                    }
                } catch (error) {
                    this.logger.error(`Failed to read session file ${file}:`, error.message);
                }
            }
            
            return null;
        } catch (error) {
            this.logger.error('Error finding session by token:', error.message);
            return null;
        }
    }

    async _removeSession(sessionId) {
        const sessionFile = path.join(this.sessionsDir, `${sessionId}.json`);
        if (fs.existsSync(sessionFile)) {
            fs.unlinkSync(sessionFile);
            this.logger.debug(`Session removed: ${sessionId}`);
        }
    }

    async _processCommand(chatId, token, command, context = {}) {
        // 查找会话
        const session = await this._findSessionByToken(token);
        if (!session) {
            await this._sendMessage(chatId, '❌ Invalid or expired token. Please wait for a new task notification.');
            return false;
        }

        // 检查会话是否过期
        const now = Math.floor(Date.now() / 1000);
        if (session.expiresAt < now) {
            await this._sendMessage(chatId, '❌ Token has expired. Please wait for a new task notification.');
            await this._removeSession(session.id);
            return false;
        }

        try {
            // 注入命令到 tmux 会话
            const tmuxSession = session.tmuxSession || 'default';
            await this.injector.injectCommand(command, tmuxSession);
            
            // 发送确认消息
            await this._sendMessage(chatId, 
                `✅ *Command sent successfully*\n\n📝 *Command:* ${command}\n🖥️ *Session:* ${tmuxSession}\n\nClaude is now processing your request...`,
                { parse_mode: 'Markdown' });
            
            // 记录命令执行
            this.logger.info(`Command injected - User: ${chatId}, Token: ${token}, Command: ${command}`);
            return true;
            
        } catch (error) {
            this.logger.error('Command injection failed:', error.message);
            await this._sendMessage(chatId, 
                `❌ *Command execution failed:* ${error.message}`,
                { parse_mode: 'Markdown' });
            return false;
        }
    }

    _parseCommand(text, chatId, replyToMessage) {
        // 格式1: /cmd TOKEN command
        let match = text.match(/^\/cmd\s+([A-Z0-9]{8})\s+(.+)$/i);
        if (match) {
            return {
                token: match[1].toUpperCase(),
                command: match[2],
                source: 'explicit_cmd'
            };
        }

        // 格式2: TOKEN command
        match = text.match(/^([A-Z0-9]{8})\s+(.+)$/);
        if (match) {
            return {
                token: match[1].toUpperCase(),
                command: match[2],
                source: 'token_prefix'
            };
        }

        // 格式3: 回复bot消息
        if (replyToMessage && replyToMessage.from?.is_bot) {
            const replyMessageId = replyToMessage.message_id;
            const tokenInfo = this.tokenMessageMap.get(replyMessageId);
            
            if (tokenInfo) {
                return {
                    token: tokenInfo.token,
                    command: text,
                    source: 'reply_to_bot'
                };
            }
        }

        // 格式4: 直接发送命令（使用最近活跃Token）
        const activeToken = this.activeTokens.get(chatId);
        if (activeToken && this._looksLikeCommand(text)) {
            const tokenAge = Date.now() - activeToken.timestamp;
            if (tokenAge < 24 * 60 * 60 * 1000) {
                return {
                    token: activeToken.token,
                    command: text,
                    source: 'active_token'
                };
            } else {
                // 清除过期的Token
                this.activeTokens.delete(chatId);
            }
        }

        return null;
    }

    _looksLikeCommand(text) {
        // 排除太短的文本
        if (text.length < 2) return false;
        
        // 排除纯符号或数字
        if (/^[\d\s\.\,\!\?\-\+\=]+$/.test(text)) return false;
        
        // 排除常见的非命令短语
        const nonCommands = [
            /^(hi|hello|hey|ok|yes|no|thanks|thx|谢谢|好的|是的|不是)$/i,
            /^[\u4e00-\u9fff]{1,2}$/,
            /^(哈哈|呵呵|嗯|啊|哦|额)$/,
        ];
        
        for (const pattern of nonCommands) {
            if (pattern.test(text)) return false;
        }
        
        return true;
    }

    async _handleIncomingMessage(message) {
        const text = message.text?.trim();
        const chatId = message.chat.id;
        const userId = message.from.id;
        const chatType = message.chat.type;
        const messageId = message.message_id;
        const replyToMessage = message.reply_to_message;
        
        if (!text) return;

        this.logger.info(`📨 Received ${chatType} message from ${userId} in chat ${chatId}: ${text}`);

        // 授权检查
        if (!this._isAuthorized(userId, chatId, chatType)) {
            this.logger.warn(`❌ Unauthorized ${chatType}: ${chatId}, User: ${userId}`);
            await this._sendMessage(chatId, '⚠️ You are not authorized to use this bot.');
            return;
        }

        // 处理特殊命令
        if (text === '/start') {
            await this._handleStartCommand(chatId);
            return;
        }

        if (text === '/help') {
            await this._sendHelpMessage(chatId);
            return;
        }

        // 解析命令
        const commandInfo = this._parseCommand(text, chatId, replyToMessage);
        
        if (commandInfo) {
            const { token, command, source } = commandInfo;
            
            this.logger.info(`💬 Command parsed via ${source}: Token=${token}, Command="${command.substring(0, 50)}${command.length > 50 ? '...' : ''}"`);
            
            await this._processCommand(chatId, token, command, { messageId, source });
        } else {
            await this._sendHelpMessage(chatId, true);
        }
    }

    async _handleStartCommand(chatId) {
        // 清理该聊天的旧Token
        const oldToken = this.activeTokens.get(chatId);
        if (oldToken) {
            this.activeTokens.delete(chatId);
        }

        const welcomeText = `👋 *Welcome to Claude Code Remote Bot!*\n\n` +
            `🎉 *Your session is ready!*\n\n` +
            `🚀 *How to send commands:*\n` +
            `• Traditional: \`/cmd TOKEN command\`\n` +
            `• Simple: \`TOKEN command\`\n` +
            `• Reply: Reply to any bot message\n\n` +
            `💡 *Bot configured for: ${
                this.config.groupId ? 'Group chat' : 
                this.config.chatId ? 'Private chat' : 
                'Dynamic private chats'
            }\n\n` +
            `Use \`/help\` for detailed instructions.`;
            
        await this._sendMessage(chatId, welcomeText, { parse_mode: 'Markdown' });
    }

    async _sendHelpMessage(chatId, showError = false) {
        let helpText = '';
        
        if (showError) {
            helpText += `❌ *Command not recognized*\n\n`;
        }
        
        helpText += `🆘 *Claude Code Remote Bot Help*\n\n` +
            `*🎯 Ways to Send Commands:*\n\n` +
            `*1️⃣ Traditional Format:*\n` +
            `\`/cmd TOKEN command\`\n` +
            `Example: \`/cmd ABC12345 analyze this code\`\n\n` +
            `*2️⃣ Simple Format:*\n` +
            `\`TOKEN command\`\n` +
            `Example: \`XYZ89012 create a new function\`\n\n` +
            `*3️⃣ Reply Format:*\n` +
            `Reply directly to any bot message\n\n` +
            `*📝 Token Info:*\n` +
            `• Tokens are 8-character codes\n` +
            `• Valid for 24 hours\n\n` +
            `*🛠️ Other Commands:*\n` +
            `• \`/start\` - Reset session\n` +
            `• \`/help\` - This help message\n\n` +
            `*💡 Pro Tip:* After receiving a notification, you can simply reply to it!`;
            
        await this._sendMessage(chatId, helpText, { parse_mode: 'Markdown' });
    }

    async _pollMessages() {
        try {
            const response = await this.httpClient.get(`/bot${this.config.botToken}/getUpdates`, {
                params: {
                    offset: this.lastUpdateId + 1,
                    timeout: this.isPolling ? 30 : 1
                }
            });
            
            if (!response.data.ok) {
                throw new Error(`Telegram API error: ${response.data.description}`);
            }

            // 成功获取消息，重置连续错误计数
            this.consecutiveErrors = 0;

            for (const update of response.data.result) {
                this.lastUpdateId = update.update_id;
                
                if (update.message && update.message.text) {
                    await this._handleIncomingMessage(update.message);
                }
            }
        } catch (error) {
            // 增强错误处理
            if (error.response) {
                const status = error.response.status;
                const description = error.response.data?.description || error.response.statusText;
                
                // 处理409冲突错误（多个实例运行）
                if (status === 409) {
                    this.logger.warn('⚠️  Another bot instance is running. Attempting to resolve conflict...');
                    
                    // 尝试清除所有挂起的更新
                    try {
                        await this.httpClient.get(`/bot${this.config.botToken}/getUpdates`, {
                            params: { offset: -1, timeout: 1 }
                        });
                        this.logger.info('✅ Conflict resolved by clearing pending updates');
                        this.lastUpdateId = 0;
                        return; // 跳过错误处理
                    } catch (clearError) {
                        this.logger.error('Failed to resolve conflict:', clearError.message);
                        throw new Error(`Bot conflict: ${description}. Please stop other bot instances.`);
                    }
                }
                
                throw new Error(`HTTP ${status}: ${description}`);
            } else if (error.code) {
                throw new Error(this._handleNetworkError(error));
            } else {
                throw error;
            }
        }
    }

    async _interruptibleDelay(ms) {
        const startTime = Date.now();
        const checkInterval = 100;
        
        while (this.isPolling && (Date.now() - startTime) < ms) {
            await new Promise(resolve => setTimeout(resolve, Math.min(checkInterval, ms - (Date.now() - startTime))));
        }
    }

    async _pollingLoop() {
        while (this.isPolling) {
            this.currentPolling = true;
            
            try {
                await this._pollMessages();
                
                // 成功轮询后，重置退避间隔
                this.pollingInterval = this.config.pollingInterval || 1000;
            } catch (error) {
                this.consecutiveErrors++;
                
                // 根据错误类型决定日志级别
                if (error.message.includes('Network error')) {
                    if (this.consecutiveErrors === 1) {
                        this.logger.warn(`🌐 Network connection issue: ${error.message}`);
                        this.logger.warn('📡 Will continue polling with exponential backoff...');
                    } else if (this.consecutiveErrors % 10 === 0) {
                        this.logger.warn(`⚠️  Still experiencing network issues after ${this.consecutiveErrors} attempts`);
                    }
                } else {
                    this.logger.error('Polling error:', error.message);
                }
                
                // 连续错误过多时，使用退避策略
                if (this.consecutiveErrors >= this.maxConsecutiveErrors) {
                    const backoffTime = Math.min(
                        this.pollingInterval * Math.pow(this.backoffMultiplier, this.consecutiveErrors - this.maxConsecutiveErrors),
                        this.maxBackoffInterval
                    );
                    
                    if (this.consecutiveErrors === this.maxConsecutiveErrors) {
                        this.logger.warn(`🔄 Too many consecutive errors (${this.consecutiveErrors}). Using exponential backoff: ${Math.round(backoffTime/1000)}s`);
                    }
                    
                    this.pollingInterval = backoffTime;
                }
            }
            
            this.currentPolling = false;
            
            // 检查是否应该继续轮询
            if (this.isPolling) {
                await this._interruptibleDelay(this.pollingInterval);
            }
        }
    }

    // 公共方法
    async start() {
        if (!this.config.botToken) {
            throw new Error('Bot token is required');
        }

        // 在启动前清除可能的旧更新
        try {
            await this.httpClient.get(`/bot${this.config.botToken}/getUpdates`, {
                params: {
                    offset: -1,
                    timeout: 1
                }
            });
            this.logger.debug('🧹 Cleared old Telegram updates');
        } catch (error) {
            this.logger.debug('⚠️  Could not clear old updates:', error.message);
        }

        this.logger.info(`🤖 Starting Telegram polling (interval: ${this.pollingInterval}ms)`);
        this.isPolling = true;
        
        // 启动轮询循环
        this._pollingLoop().catch(error => {
            this.logger.error('Polling loop crashed:', error);
        });
    }

    async stop() {
        this.logger.info('🛑 Stopping Telegram polling...');
        this.isPolling = false;
        
        // 快速取消当前请求
        if (this.httpClient) {
            this.httpClient.defaults.timeout = 1000;
        }
        
        // 等待当前轮询完成
        const startTime = Date.now();
        const maxWaitTime = 5000;
        
        while (this.currentPolling && (Date.now() - startTime) < maxWaitTime) {
            await new Promise(resolve => setTimeout(resolve, 100));
        }
        
        if (this.currentPolling) {
            this.logger.warn('⚠️  Force stopping polling due to timeout');
            this.currentPolling = false;
        }
        
        // 重置错误计数器
        this.consecutiveErrors = 0;
        this.pollingInterval = this.config.pollingInterval || 1000;
        
        this.logger.info('✅ Telegram polling stopped');
    }

    // 为通知系统创建会话的方法
    async createNotificationSession(notification) {
        const sessionId = require('uuid').v4();
        const token = this._generateToken();
        
        const session = {
            id: sessionId,
            token: token,
            type: 'telegram',
            created: new Date().toISOString(),
            expires: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
            createdAt: Math.floor(Date.now() / 1000),
            expiresAt: Math.floor((Date.now() + 24 * 60 * 60 * 1000) / 1000),
            tmuxSession: notification.metadata?.tmuxSession || 'default',
            project: notification.project,
            notification: notification,
            chatId: this.config.groupId || this.config.chatId,
            telegramConfig: {
                botToken: this.config.botToken ? '***configured***' : null,
                whitelist: this.config.whitelist || []
            }
        };

        const sessionFile = path.join(this.sessionsDir, `${sessionId}.json`);
        fs.writeFileSync(sessionFile, JSON.stringify(session, null, 2));
        
        this.logger.debug(`Telegram notification session created: ${sessionId}`);
        return { sessionId, token };
    }

    // 发送通知消息的方法
    async sendNotificationMessage(chatId, messageText, token, sessionId) {
        const requestData = {
            chat_id: chatId,
            text: messageText,
            parse_mode: 'Markdown',
            reply_markup: {
                inline_keyboard: [[
                    {
                        text: '📝 Reply with Command',
                        callback_data: `session:${token}`
                    }
                ]]
            }
        };

        try {
            const response = await this.httpClient.post(`/bot${this.config.botToken}/sendMessage`, requestData);

            if (response.status === 200 && response.data.ok) {
                const messageId = response.data.result.message_id;
                // 记录Token与消息ID的映射
                this.tokenMessageMap.set(messageId, { token, sessionId });
                this.activeTokens.set(chatId, { 
                    token, 
                    timestamp: Date.now(), 
                    messageId,
                    sessionId 
                });
                
                this.logger.info(`Telegram notification sent successfully, Session: ${sessionId}, MessageID: ${messageId}`);
                return true;
            } else {
                throw new Error(`Telegram API error: ${response.data.description || 'Unknown error'}`);
            }
        } catch (error) {
            let errorMessage = error.message;
            
            if (error.response) {
                errorMessage = `HTTP ${error.response.status}: ${error.response.data?.description || error.response.statusText}`;
            } else if (error.code) {
                errorMessage = this._handleNetworkError(error);
            }
            
            this.logger.error('Failed to send Telegram notification:', errorMessage);
            return false;
        }
    }
}

module.exports = TelegramPollingHandler;