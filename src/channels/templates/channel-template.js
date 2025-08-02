/**
 * New Channel Template
 * 新频道实现模板 - 复制此文件来创建新的频道支持
 * 
 * 使用方法：
 * 1. 复制此文件到对应目录（如 src/channels/chat/discord.js）
 * 2. 替换所有 "Template" 为实际频道名称
 * 3. 实现所有标记为 "TODO" 的方法
 * 4. 更新 capabilities 定义
 * 5. 在配置文件中添加频道配置
 */

const NotificationChannel = require('../base/channel');
const path = require('path');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');

class TemplateChannel extends NotificationChannel {
    constructor(config = {}) {
        super('template', config); // TODO: 替换 'template' 为实际频道名
        
        // TODO: 初始化频道特有的配置
        this.apiKey = config.apiKey || process.env.TEMPLATE_API_KEY;
        this.channelId = config.channelId || process.env.TEMPLATE_CHANNEL_ID;
        this.apiBaseUrl = 'https://api.template-service.com'; // TODO: 替换为实际 API 地址
        
        // 会话管理
        this.sessionsDir = path.join(__dirname, '../../data/sessions');
        
        this._ensureDirectories();
    }

    /**
     * 定义频道能力 - 根据实际频道特性修改
     */
    _defineCapabilities() {
        return {
            canSend: true,           // 可以发送通知
            canReceive: true,        // 可以接收命令 - TODO: 根据实际情况设置
            supportsRelay: true,     // 支持命令中继 - TODO: 根据实际情况设置
            supportsPolling: false,  // 支持轮询监听 - TODO: 根据实际情况设置
            supportsWebhook: true,   // 支持 Webhook - TODO: 根据实际情况设置
            supportsFiles: false,    // 支持文件传输 - TODO: 根据实际情况设置
            supportsMarkdown: true,  // 支持 Markdown - TODO: 根据实际情况设置
            requiresAuth: true,      // 需要认证 - TODO: 根据实际情况设置
            hasPresence: false       // 有在线状态 - TODO: 根据实际情况设置
        };
    }

    /**
     * 确保必要的目录存在
     */
    _ensureDirectories() {
        if (!fs.existsSync(this.sessionsDir)) {
            fs.mkdirSync(this.sessionsDir, { recursive: true });
        }
    }

    /**
     * 验证频道配置
     */
    validateConfig() {
        if (!this.apiKey) {
            this.logger.warn('Template API key not found');
            return false;
        }
        if (!this.channelId) {
            this.logger.warn('Template channel ID not configured');
            return false;
        }
        return true;
    }

    // ========== 基类抽象方法实现 ==========

    /**
     * 发送通知的具体实现
     * TODO: 实现发送通知到实际服务的逻辑
     */
    async _sendImpl(notification) {
        if (!this.validateConfig()) {
            throw new Error('Template channel not properly configured');
        }

        try {
            // TODO: 实现实际的发送逻辑
            // 示例结构：
            
            // 1. 生成会话和 Token
            const sessionId = uuidv4();
            const token = this._generateToken();
            
            // 2. 创建会话记录
            await this._createSession(sessionId, notification, token);
            
            // 3. 构建消息
            const message = this._buildMessage(notification, sessionId, token);
            
            // 4. 发送到实际服务
            const response = await this._sendToService(message);
            
            // 5. 处理响应
            if (response.success) {
                this.logger.info(`Template message sent successfully, Session: ${sessionId}`);
                return true;
            } else {
                // 清理失败的会话
                await this._removeSession(sessionId);
                return false;
            }
            
        } catch (error) {
            this.logger.error('Failed to send Template message:', error);
            return false;
        }
    }

    /**
     * 启动监听的具体实现
     * TODO: 实现启动监听的逻辑（如果支持 canReceive）
     */
    async _startListeningImpl() {
        if (!this.capabilities.canReceive) {
            return; // 不支持接收消息，跳过
        }

        if (!this.validateConfig()) {
            throw new Error('Template configuration invalid');
        }

        this.logger.info('🎧 Starting Template listener...');
        
        // TODO: 实现监听逻辑
        // 可以是轮询、WebSocket 连接、Webhook 设置等
        
        if (this.capabilities.supportsPolling) {
            // 轮询模式示例
            this.isPolling = true;
            this._pollingLoop().catch(error => {
                this.logger.error('Template polling loop crashed:', error);
                this.emit('listenerError', { type: this.type, error });
            });
        } else if (this.capabilities.supportsWebhook) {
            // Webhook 模式示例
            await this._setupWebhook();
        }
    }

    /**
     * 停止监听的具体实现
     * TODO: 实现停止监听的逻辑
     */
    async _stopListeningImpl() {
        if (!this.capabilities.canReceive) {
            return;
        }

        this.logger.info('🛑 Stopping Template listener...');
        
        // TODO: 实现停止逻辑
        if (this.capabilities.supportsPolling) {
            this.isPolling = false;
        } else if (this.capabilities.supportsWebhook) {
            await this._removeWebhook();
        }
    }

    /**
     * 处理命令的具体实现
     * TODO: 实现命令处理逻辑
     */
    async _handleCommandImpl(command, context) {
        const { token } = context;
        
        if (!token) {
            throw new Error('Missing token in Template command context');
        }

        // 查找会话
        const session = await this._findSessionByToken(token);
        if (!session) {
            await this._sendErrorResponse(context, '❌ Invalid or expired token.');
            return false;
        }

        // 检查会话是否过期
        if (session.expiresAt < Math.floor(Date.now() / 1000)) {
            await this._sendErrorResponse(context, '❌ Token has expired.');
            await this._removeSession(session.id);
            return false;
        }

        try {
            // 使用 tmux 注入器执行命令
            const TmuxInjector = require('../../relay/tmux-injector');
            const tmuxInjector = new TmuxInjector();
            const tmuxSession = session.tmuxSession || 'default';
            
            const injectionResult = await tmuxInjector.injectCommand(tmuxSession, command);
            
            if (injectionResult.success) {
                await this._sendSuccessResponse(context, command, tmuxSession);
                return true;
            } else {
                await this._sendErrorResponse(context, `❌ Command injection failed: ${injectionResult.error}`);
                return false;
            }
        } catch (error) {
            await this._sendErrorResponse(context, `❌ Error processing command: ${error.message}`);
            throw error;
        }
    }

    // ========== 频道特有的私有方法 ==========

    /**
     * 生成会话 Token
     */
    _generateToken() {
        const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
        let token = '';
        for (let i = 0; i < 8; i++) {
            token += chars.charAt(Math.floor(Math.random() * chars.length));
        }
        return token;
    }

    /**
     * 创建会话记录
     */
    async _createSession(sessionId, notification, token) {
        const baseSession = {
            id: sessionId,
            token: token,
            type: 'template', // TODO: 替换为实际频道类型
            created: new Date().toISOString(),
            expires: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
            createdAt: Math.floor(Date.now() / 1000),
            expiresAt: Math.floor((Date.now() + 24 * 60 * 60 * 1000) / 1000),
            tmuxSession: notification.metadata?.tmuxSession || 'default',
            project: notification.project,
            notification: notification,
            // TODO: 添加频道特有的上下文信息
            templateConfig: {
                channelId: this.channelId,
                apiKey: this.apiKey ? '***configured***' : null
            }
        };

        // 使用基类方法添加来源信息
        const sessionWithOrigin = this.createSessionWithOrigin(baseSession);

        const sessionFile = path.join(this.sessionsDir, `${sessionId}.json`);
        fs.writeFileSync(sessionFile, JSON.stringify(sessionWithOrigin, null, 2));
        
        this.logger.debug(`Template session created: ${sessionId}`);
    }

    /**
     * 移除会话记录
     */
    async _removeSession(sessionId) {
        const sessionFile = path.join(this.sessionsDir, `${sessionId}.json`);
        if (fs.existsSync(sessionFile)) {
            fs.unlinkSync(sessionFile);
            this.logger.debug(`Session removed: ${sessionId}`);
        }
    }

    /**
     * 根据 Token 查找会话
     */
    async _findSessionByToken(token) {
        try {
            const files = fs.readdirSync(this.sessionsDir);
            
            for (const file of files) {
                if (!file.endsWith('.json')) continue;
                
                const sessionPath = path.join(this.sessionsDir, file);
                const session = JSON.parse(fs.readFileSync(sessionPath, 'utf8'));
                if (session.token === token) {
                    return session;
                }
            }
        } catch (error) {
            this.logger.error('Error finding session:', error.message);
        }
        
        return null;
    }

    /**
     * 构建发送消息
     * TODO: 根据实际服务的消息格式定制
     */
    _buildMessage(notification, sessionId, token) {
        const type = notification.type;
        const emoji = type === 'completed' ? '✅' : '⏳';
        const status = type === 'completed' ? 'Completed' : 'Waiting for Input';
        
        let messageText = `${emoji} **Claude Task ${status}**\n`;
        messageText += `**Project:** ${notification.project}\n`;
        messageText += `**Session Token:** \`${token}\`\n\n`;
        
        if (notification.metadata) {
            if (notification.metadata.userQuestion) {
                messageText += `📝 **Your Question:**\n${notification.metadata.userQuestion.substring(0, 200)}`;
                if (notification.metadata.userQuestion.length > 200) {
                    messageText += '...';
                }
                messageText += '\n\n';
            }
            
            if (notification.metadata.claudeResponse) {
                messageText += `🤖 **Claude Response:**\n${notification.metadata.claudeResponse.substring(0, 300)}`;
                if (notification.metadata.claudeResponse.length > 300) {
                    messageText += '...';
                }
                messageText += '\n\n';
            }
        }
        
        messageText += `💬 **To send a new command:**\n`;
        messageText += `Reply with: \`${token} <your command>\`\n`;
        messageText += `Example: \`${token} Please analyze this code\``;

        return messageText;
    }

    /**
     * 发送到实际服务
     * TODO: 实现发送到实际服务的 API 调用
     */
    async _sendToService(message) {
        // TODO: 实现实际的 API 调用
        // 示例结构：
        /*
        const response = await fetch(`${this.apiBaseUrl}/send`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${this.apiKey}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                channel: this.channelId,
                message: message
            })
        });
        
        return {
            success: response.ok,
            data: await response.json()
        };
        */
        
        // 临时模拟实现
        this.logger.info('Template message would be sent:', message.substring(0, 100) + '...');
        return { success: true };
    }

    /**
     * 轮询循环 (如果支持轮询)
     * TODO: 实现轮询逻辑
     */
    async _pollingLoop() {
        while (this.isPolling) {
            try {
                // TODO: 实现轮询检查新消息的逻辑
                await this._checkNewMessages();
                await new Promise(resolve => setTimeout(resolve, this.pollingInterval || 5000));
            } catch (error) {
                this.logger.error('Template polling error:', error);
                this.statistics.errors++;
                await new Promise(resolve => setTimeout(resolve, 10000)); // 错误后等待更长时间
            }
        }
    }

    /**
     * 检查新消息 (轮询模式)
     * TODO: 实现检查新消息的逻辑
     */
    async _checkNewMessages() {
        // TODO: 实现从服务获取新消息的逻辑
        // 解析消息中的命令和 Token
        // 调用 this.handleCommand(command, context)
    }

    /**
     * 设置 Webhook (如果支持)
     * TODO: 实现 Webhook 设置
     */
    async _setupWebhook() {
        // TODO: 实现 Webhook 设置逻辑
        this.logger.info('Template webhook setup - TODO: implement');
    }

    /**
     * 移除 Webhook
     * TODO: 实现 Webhook 清理
     */
    async _removeWebhook() {
        // TODO: 实现 Webhook 清理逻辑
        this.logger.info('Template webhook removal - TODO: implement');
    }

    /**
     * 发送成功响应
     */
    async _sendSuccessResponse(context, command, tmuxSession) {
        // TODO: 实现发送成功响应到对应频道
        const message = `✅ **Command sent successfully**\n\n📝 **Command:** ${command}\n🖥️ **Session:** ${tmuxSession}\n\nClaude is now processing your request...`;
        this.logger.info('Success response would be sent:', message);
    }

    /**
     * 发送错误响应
     */
    async _sendErrorResponse(context, errorMessage) {
        // TODO: 实现发送错误响应到对应频道
        this.logger.info('Error response would be sent:', errorMessage);
    }

    /**
     * 测试频道配置
     */
    async test() {
        try {
            if (!this.validateConfig()) {
                throw new Error('Template configuration invalid');
            }

            // 发送测试通知
            const testNotification = {
                type: 'completed',
                title: 'Claude-Code-Remote Test',
                message: 'This is a test message from Template channel.',
                project: 'Test',
                metadata: {
                    test: true,
                    timestamp: new Date().toISOString()
                }
            };

            const result = await this._sendImpl(testNotification);
            return result;
        } catch (error) {
            this.logger.error('Template test failed:', error.message);
            return false;
        }
    }
}

module.exports = TemplateChannel;