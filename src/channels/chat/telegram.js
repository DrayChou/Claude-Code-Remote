/**
 * Telegram Notification Channel
 * Sends notifications via Telegram bot API with reply support
 */

const NotificationChannel = require('../base/channel');
const path = require('path');
const fs = require('fs');
const TmuxMonitor = require('../../utils/tmux-monitor');
const ClaudeHeadlessExecutor = require('../../relay/claude-headless-executor');
const { execSync } = require('child_process');
const axios = require('axios');

// Load environment variables for the executor
require('dotenv').config({ path: path.join(__dirname, '../../../.env') });

// 简单的 UUID 生成器（避免依赖问题）
function generateUuid() {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
        const r = Math.random() * 16 | 0;
        const v = c === 'x' ? r : (r & 0x3 | 0x8);
        return v.toString(16);
    });
}

class TelegramChannel extends NotificationChannel {
    constructor(config = {}) {
        super('telegram', config);
        
        // Support environment variables as fallback
        this.botToken = config.botToken || config.token || process.env.TELEGRAM_BOT_TOKEN;
        this.chatId = config.chatId || process.env.TELEGRAM_CHAT_ID;
        this.groupId = config.groupId || process.env.TELEGRAM_GROUP_ID;
        
        // Parse whitelist from config or environment
        let whitelist = config.whitelist || [];
        if (process.env.TELEGRAM_WHITELIST) {
            const envWhitelist = process.env.TELEGRAM_WHITELIST.split(',').map(id => id.trim()).filter(Boolean);
            whitelist = whitelist.concat(envWhitelist);
        }
        this.whitelist = [...new Set(whitelist)]; // Remove duplicates
        
        this.tmuxMonitor = new TmuxMonitor();
        this.claudeExecutor = new ClaudeHeadlessExecutor(this.logger);
        this.sessionsDir = path.join(__dirname, '../../data/sessions');
        this.apiBaseUrl = 'https://api.telegram.org';
        this.pollingInterval = config.pollingInterval || 1000;
        this.lastUpdateId = 0;
        
        // 用于追踪每个聊天的最近活跃Token和消息映射
        this.activeTokens = new Map(); // chatId -> {token, timestamp, messageId}
        this.tokenMessageMap = new Map(); // messageId -> {token, sessionId}
        
        // 错误处理和重试
        this.consecutiveErrors = 0;
        this.maxConsecutiveErrors = 5;
        this.backoffMultiplier = 2;
        this.maxBackoffInterval = 60000; // 最大退避间隔 1 分钟
        
        // 代理设置
        this.proxyConfig = this._setupProxy();
        
        this._ensureDirectories();
    }

    /**
     * 定义 Telegram 频道能力
     */
    _defineCapabilities() {
        return {
            canSend: true,           // 可以发送通知
            canReceive: true,        // 可以接收命令
            supportsRelay: true,     // 支持命令中继
            supportsPolling: true,   // 支持轮询监听
            supportsWebhook: true,   // 支持 Webhook
            supportsFiles: true,     // 支持文件传输
            supportsMarkdown: true,  // 支持 Markdown
            requiresAuth: true,      // 需要认证
            hasPresence: true        // 有在线状态
        };
    }

    _validateConfig() {
        if (!this.botToken) {
            this.logger.warn('Telegram Bot Token not found');
            return false;
        }
        // 支持仅配置 Bot Token，运行时动态获取聊天对象
        // 如果配置了 chatId 或 groupId，则优先使用
        // 如果都没配置，则接受任何授权用户的私聊
        return true;
    }

    _ensureDirectories() {
        if (!fs.existsSync(this.sessionsDir)) {
            fs.mkdirSync(this.sessionsDir, { recursive: true });
        }
    }

    _setupProxy() {
        // 只使用 HTTP_PROXY 环境变量
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
            timeout: 60000, // 增加超时时间
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
            
            this.logger.debug('🔓 SSL certificate verification disabled and relaxed SSL settings applied for proxy connection');
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
        // Generate short Token (uppercase letters + numbers, 8 digits)
        const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
        let token = '';
        for (let i = 0; i < 8; i++) {
            token += chars.charAt(Math.floor(Math.random() * chars.length));
        }
        return token;
    }

    _getCurrentTmuxSession() {
        try {
            const tmuxSession = execSync('tmux display-message -p "#S"', { 
                encoding: 'utf8',
                stdio: ['ignore', 'pipe', 'ignore']
            }).trim();
            return tmuxSession || null;
        } catch (error) {
            return null;
        }
    }

    async _sendImpl(notification) {
        if (!this._validateConfig()) {
            throw new Error('Telegram channel not properly configured');
        }

        // Generate session ID and token
        const sessionId = generateUuid();
        const token = this._generateToken();
        
        // Get current tmux session and conversation content
        const tmuxSession = this._getCurrentTmuxSession();
        if (tmuxSession && !notification.metadata) {
            const conversation = this.tmuxMonitor.getRecentConversation(tmuxSession);
            notification.metadata = {
                userQuestion: conversation.userQuestion || notification.message,
                claudeResponse: conversation.claudeResponse || notification.message,
                tmuxSession: tmuxSession
            };
        }
        
        // Create session record
        await this._createSession(sessionId, notification, token);

        // Generate Telegram message
        const messageText = this._generateTelegramMessage(notification, sessionId, token);
        
        // 智能确定接收者：群聊优先，然后是私聊，最后是动态聊天
        const chatId = this.groupId || this.chatId || notification.metadata?.dynamicChatId;
        
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
            const httpClient = this._createAxiosInstance();
            const response = await httpClient.post(`/bot${this.botToken}/sendMessage`, requestData);

            if (response.status === 200 && response.data.ok) {
                const messageId = response.data.result.message_id;
                // 记录Token与消息ID的映射，方便回复消息时查找
                this.tokenMessageMap.set(messageId, { token, sessionId });
                this.activeTokens.set(chatId, { 
                    token, 
                    timestamp: Date.now(), 
                    messageId,
                    sessionId 
                });
                
                this.logger.info(`Telegram message sent successfully, Session: ${sessionId}, MessageID: ${messageId}`);
                return true;
            } else {
                throw new Error(`Telegram API error: ${response.data.description || 'Unknown error'}`);
            }
        } catch (error) {
            let errorMessage = error.message;
            
            // 处理 axios 错误
            if (error.response) {
                errorMessage = `HTTP ${error.response.status}: ${error.response.data?.description || error.response.statusText}`;
            } else if (error.code) {
                errorMessage = this._handleNetworkError(error);
            }
            
            this.logger.error('Failed to send Telegram message:', errorMessage);
            // Clean up failed session
            await this._removeSession(sessionId);
            return false;
        }
    }

    async _createSession(sessionId, notification, token) {
        // 使用基类的会话创建方法，确保来源信息正确
        const baseSession = {
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
            // Telegram 特有的上下文信息
            chatId: this.groupId || this.chatId,
            telegramConfig: {
                botToken: this.botToken ? '***configured***' : null,
                whitelist: this.whitelist
            }
        };

        // 使用基类方法添加来源信息
        const sessionWithOrigin = this.createSessionWithOrigin(baseSession);

        const sessionFile = path.join(this.sessionsDir, `${sessionId}.json`);
        fs.writeFileSync(sessionFile, JSON.stringify(sessionWithOrigin, null, 2));
        
        this.logger.debug(`Telegram session created: ${sessionId} for chat: ${sessionWithOrigin.chatId}`);
    }

    async _removeSession(sessionId) {
        const sessionFile = path.join(this.sessionsDir, `${sessionId}.json`);
        if (fs.existsSync(sessionFile)) {
            fs.unlinkSync(sessionFile);
            this.logger.debug(`Session removed: ${sessionId}`);
        }
    }

    _generateTelegramMessage(notification, sessionId, token) {
        const type = notification.type;
        const emoji = type === 'completed' ? '✅' : '⏳';
        const status = type === 'completed' ? 'Completed' : 'Waiting for Input';
        
        let messageText = `${emoji} *Claude Task ${status}*\n`;
        messageText += `*Project:* ${notification.project}\n`;
        messageText += `*Session Token:* \`${token}\`\n\n`;
        
        if (notification.metadata) {
            if (notification.metadata.userQuestion) {
                messageText += `📝 *Your Question:*\n${notification.metadata.userQuestion.substring(0, 200)}`;
                if (notification.metadata.userQuestion.length > 200) {
                    messageText += '...';
                }
                messageText += '\n\n';
            }
            
            if (notification.metadata.claudeResponse) {
                messageText += `🤖 *Claude Response:*\n${notification.metadata.claudeResponse.substring(0, 300)}`;
                if (notification.metadata.claudeResponse.length > 300) {
                    messageText += '...';
                }
                messageText += '\n\n';
            }
        }
        
        messageText += `💬 *To send a new command (4 ways):*\n`;
        messageText += `1️⃣ Reply to this message directly\n`;
        messageText += `2️⃣ Send: \`${token} <your command>\`\n`;
        messageText += `3️⃣ Send: \`/cmd ${token} <your command>\`\n`;
        messageText += `4️⃣ Just send your command (I'll remember this token)\n\n`;
        messageText += `💡 *Easiest way: Just reply to this message!*`;

        return messageText;
    }

    supportsRelay() {
        return true;
    }


    // ========== 基类抽象方法实现 ==========

    /**
     * 启动 Telegram 轮询监听
     */
    async _startListeningImpl() {
        if (!this._validateConfig()) {
            throw new Error('Telegram configuration invalid');
        }

        // 在启动前清除可能的旧更新，防止409冲突
        try {
            const httpClient = this._createAxiosInstance();
            await httpClient.get(`/bot${this.botToken}/getUpdates`, {
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
            this.emit('listenerError', { type: this.type, error });
        });
    }

    /**
     * 停止 Telegram 轮询监听
     */
    async _stopListeningImpl() {
        this.logger.info('🛑 Stopping Telegram polling...');
        this.isPolling = false;
        
        // 取消正在进行的HTTP请求
        if (this.currentAxiosInstance) {
            this.currentAxiosInstance.defaults.timeout = 1000; // 快速超时
        }
        
        // 等待当前轮询完成，但有超时限制
        const startTime = Date.now();
        const maxWaitTime = 5000; // 最多等待5秒
        
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

    /**
     * 处理 Telegram 命令
     */
    async _handleCommandImpl(command, context) {
        const { chatId, token } = context;
        
        if (!token) {
            throw new Error('Missing token in Telegram command context');
        }

        // 查找会话
        const session = await this._findSessionByToken(token);
        if (!session) {
            await this._sendMessage(chatId, '❌ Invalid or expired token. Please wait for a new task notification.');
            return false;
        }

        // 检查会话是否过期
        if (session.expiresAt < Math.floor(Date.now() / 1000)) {
            await this._sendMessage(chatId, '❌ Token has expired. Please wait for a new task notification.');
            await this._removeSession(session.id);
            return false;
        }

        try {
            // 发送处理状态消息
            const processingMessageId = await this._sendProcessingMessage(chatId, command);
            
            // 使用新的无头执行器执行命令
            this.logger.debug(`About to execute command: ${command}`);
            
            // 生成有效的UUID格式的sessionId
            const validSessionId = session.id || generateUuid();
            
            // 执行命令，禁用流模式避免过多消息编辑
            const options = {
                timeout: 60000, // 1分钟超时
                sessionId: validSessionId,
                streaming: false  // 禁用流式模式，直接等待完整结果
            };
            
            const executionResult = await this.claudeExecutor.executeCommand(command, options);
            this.logger.debug('Execution result:', JSON.stringify(executionResult, null, 2));
            
            if (executionResult.success) {
                // 确保发送最终回复给用户
                const response = executionResult.assistantResponse || 'Command executed successfully';
                
                const replyOptions = { parse_mode: 'Markdown' };
                if (context.replyToMessageId) {
                    replyOptions.reply_to_message_id = context.replyToMessageId;
                }
                
                // 智能分片发送长消息
                await this._sendLongMessage(chatId, {
                    command,
                    duration: executionResult.duration,
                    method: executionResult.method,
                    response: response
                }, replyOptions);
                
                this.logger.info(`✅ Command execution completed successfully: ${command}`);
                return true;
            } else {
                const replyOptions = { parse_mode: 'Markdown' };
                
                if (context.replyToMessageId) {
                    replyOptions.reply_to_message_id = context.replyToMessageId;
                }
                
                // 根据错误类型显示不同的错误消息
                let errorMessage;
                if (executionResult.error === 'authentication_required') {
                    errorMessage = `🔐 *Authentication Required*\n\nClaude is not authenticated. Please run:\n\`claude --login\`\n\nThen try your command again.`;
                } else {
                    errorMessage = `❌ *Command execution failed:* ${executionResult.error || 'Unknown error'}`;
                }
                
                await this._sendMessage(chatId, errorMessage, replyOptions);
                return false;
            }
        } catch (error) {
            await this._sendMessage(chatId, 
                `❌ *Error processing command:* ${error.message}`,
                { parse_mode: 'Markdown' });
            throw error;
        }
    }
    
    /**
     * 完成流式消息处理
     */
    async _finishStreamingMessage(chatId, context, finalOutput) {
        if (!this.streamingMessages) {
            return;
        }
        
        const key = `${chatId}_${context.token}`;
        const streamData = this.streamingMessages.get(key);
        
        if (streamData && streamData.messageId) {
            try {
                // 清理和提取最终的Claude响应
                let cleanContent = streamData.content;
                
                // 移除可能的系统消息（新的执行器输出格式）
                const systemPatterns = [
                    /^🔄 \*Processing\.\.\.\*$/m,
                    /^\*{0,3}Command completed.*$/m,
                    /^\*{0,3}✅ Command completed.*$/m,
                    /^\*{0,3}❌ Command failed.*$/m
                ];
                
                for (const pattern of systemPatterns) {
                    cleanContent = cleanContent.replace(pattern, '').trim();
                }
                
                // 移除多余的空行
                cleanContent = cleanContent.replace(/\n\s*\n\s*\n/g, '\n\n').trim();
                
                // 如果内容为空，使用原始输出
                if (!cleanContent) {
                    cleanContent = finalOutput.substring(0, 2000) + (finalOutput.length > 2000 ? '...' : '');
                }
                
                // 最终完成消息
                const finalText = `✅ **Command completed**\n\n📝 **Command:** ${context.command || 'Unknown'}\n💻 **Method:** Claude headless mode\n\n**Response:**\n${cleanContent}`;
                
                await this._editMessage(chatId, streamData.messageId, finalText.substring(0, 4000));
                
                // 清理流数据
                this.streamingMessages.delete(key);
            } catch (error) {
                this.logger.warn('Failed to finish streaming message:', error.message);
            }
        }
    }
    
    /**
     * 发送简单的处理状态消息（替代复杂的流式处理）
     */
    async _sendProcessingMessage(chatId, command) {
        try {
            const processingText = `🔄 *Processing command...*\n\n\`${command.length > 100 ? command.substring(0, 100) + '...' : command}\``;
            const response = await this._sendMessage(chatId, processingText, { parse_mode: 'Markdown' });
            return response?.message_id || null;
        } catch (error) {
            this.logger.warn('Failed to send processing message:', error.message);
            return null;
        }
    }

    /**
     * 智能分片发送长消息
     */
    async _sendLongMessage(chatId, messageData, replyOptions = {}) {
        const { command, duration, method, response } = messageData;
        
        const commandPreview = command.length > 50 ? command.substring(0, 50) + '...' : command;
        const header = `✅ **Command completed**\n\n` +
            `📝 **Command:** \`${commandPreview}\`\n` +
            `⏱️ **Duration:** ${duration || 'Unknown'}ms\n` +
            `🔧 **Method:** ${method || 'Claude headless'}\n\n`;
        
        const responseHeader = `**Claude Response:**\n`;
        
        // 计算可用空间（Telegram 限制 4096 字符）
        const telegramLimit = 4096;
        const reservedSpace = 200; // 为分片信息预留空间
        const maxContentLength = telegramLimit - reservedSpace;
        
        // 如果总长度在限制内，直接发送
        const totalLength = header.length + responseHeader.length + response.length;
        if (totalLength <= maxContentLength) {
            const finalMessage = header + responseHeader + response;
            await this._sendMessage(chatId, finalMessage, { ...replyOptions, parse_mode: 'Markdown' });
            return;
        }
        
        // 需要分片发送
        this.logger.info(`Message too long (${totalLength} chars), splitting into chunks`);
        
        // 第一条消息包含头部信息
        const firstChunkMaxLength = maxContentLength - header.length - responseHeader.length;
        const chunks = this._splitTextIntoChunks(response, firstChunkMaxLength, maxContentLength - 100); // 后续消息留更多空间给分片信息
        
        // 发送第一条消息（带头部）
        const firstChunkText = chunks.length > 1 ? 
            `${header}${responseHeader}${chunks[0]}\n\n📄 *[Part 1 of ${chunks.length}]*` :
            `${header}${responseHeader}${chunks[0]}`;
        
        this.logger.info(`📤 Sending first chunk to Telegram (${firstChunkText.length} chars):`);
        this.logger.info(`📄 First chunk content:\n${firstChunkText}`);
        this.logger.info('--- End of first chunk ---');
            
        await this._sendMessage(chatId, firstChunkText, { ...replyOptions, parse_mode: 'Markdown' });
        
        // 发送后续分片（如果有）
        let sentChunks = 1; // 第一条已发送
        for (let i = 1; i < chunks.length; i++) {
            // 增加间隔时间，避免API限制
            const delay = Math.min(1000 + (i - 1) * 500, 3000); // 递增延迟，最多3秒
            await new Promise(resolve => setTimeout(resolve, delay));
            
            const chunkText = `📄 *[Part ${i + 1} of ${chunks.length}]*\n\n${chunks[i]}`;
            
            // 重试逻辑
            let retryCount = 0;
            const maxRetries = 3;
            let sentSuccessfully = false;
            
            while (retryCount < maxRetries && !sentSuccessfully) {
                try {
                    this.logger.debug(`Attempting to send chunk ${i + 1}/${chunks.length} (attempt ${retryCount + 1})`);
                    
                    const result = await this._sendMessage(chatId, chunkText, { ...replyOptions, parse_mode: 'Markdown' });
                    
                    if (result) {
                        sentChunks++;
                        sentSuccessfully = true;
                        this.logger.debug(`✅ Sent chunk ${i + 1}/${chunks.length} successfully`);
                        
                        // 成功发送后稍微延迟一下
                        if (i < chunks.length - 1) {
                            await new Promise(resolve => setTimeout(resolve, 500));
                        }
                    } else {
                        retryCount++;
                        this.logger.warn(`⚠️ Failed to send chunk ${i + 1}/${chunks.length} (attempt ${retryCount})`);
                        
                        if (retryCount < maxRetries) {
                            // 指数退避
                            const backoffDelay = Math.pow(2, retryCount) * 1000;
                            this.logger.debug(`Retrying in ${backoffDelay}ms...`);
                            await new Promise(resolve => setTimeout(resolve, backoffDelay));
                        }
                    }
                } catch (error) {
                    retryCount++;
                    this.logger.error(`❌ Error sending chunk ${i + 1}/${chunks.length} (attempt ${retryCount}):`, error.message);
                    
                    if (retryCount < maxRetries) {
                        // 指数退避
                        const backoffDelay = Math.pow(2, retryCount) * 1000;
                        this.logger.debug(`Retrying in ${backoffDelay}ms...`);
                        await new Promise(resolve => setTimeout(resolve, backoffDelay));
                    }
                }
            }
            
            if (!sentSuccessfully) {
                this.logger.error(`💥 Failed to send chunk ${i + 1}/${chunks.length} after ${maxRetries} attempts`);
                // 记录失败的分片，但继续发送下一个
            }
        }
        
        this.logger.info(`📊 Long message sent in ${sentChunks}/${chunks.length} parts`);
        
        // 如果有分片发送失败，记录警告
        if (sentChunks < chunks.length) {
            this.logger.warn(`⚠️ Some chunks failed to send: ${chunks.length - sentChunks} chunks failed`);
        }
    }

    /**
     * 智能分割文本，优先在合适的位置分割
     */
    _splitTextIntoChunks(text, firstChunkMaxLength, subsequentChunkMaxLength) {
        const chunks = [];
        let remainingText = text;
        let isFirstChunk = true;
        
        while (remainingText.length > 0) {
            const maxLength = isFirstChunk ? firstChunkMaxLength : subsequentChunkMaxLength;
            
            if (remainingText.length <= maxLength) {
                // 剩余文本可以放在一个分片中
                chunks.push(remainingText);
                break;
            }
            
            // 寻找最佳分割点
            const chunk = this._findBestSplitPoint(remainingText, maxLength);
            chunks.push(chunk);
            remainingText = remainingText.substring(chunk.length).trim();
            isFirstChunk = false;
        }
        
        return chunks;
    }

    /**
     * 寻找最佳分割点，优先考虑：
     * 1. 双换行（段落分隔）
     * 2. 单换行
     * 3. 句号后的空格
     * 4. 逗号后的空格
     * 5. 空格
     * 6. 强制分割
     */
    _findBestSplitPoint(text, maxLength) {
        if (text.length <= maxLength) {
            return text;
        }
        
        const searchText = text.substring(0, maxLength);
        
        // 优先级列表：越前面优先级越高
        const splitPatterns = [
            /\n\n/g,           // 双换行（段落分隔）
            /\n/g,             // 单换行
            /\. /g,            // 句号后空格
            /\.\n/g,           // 句号后换行
            /, /g,             // 逗号后空格
            /，/g,             // 中文逗号
            /；/g,             // 中文分号
            /。/g,             // 中文句号
            / /g               // 空格
        ];
        
        for (const pattern of splitPatterns) {
            const matches = [...searchText.matchAll(pattern)];
            if (matches.length > 0) {
                // 找到最后一个匹配位置
                const lastMatch = matches[matches.length - 1];
                const splitIndex = lastMatch.index + lastMatch[0].length;
                
                // 确保分割点不会太靠前（至少要有 maxLength 的 60%）
                if (splitIndex >= maxLength * 0.6) {
                    return text.substring(0, splitIndex);
                }
            }
        }
        
        // 如果找不到合适的分割点，强制分割并添加连接符
        return text.substring(0, maxLength - 3) + '...';
    }
    
    /**
     * 编辑Telegram消息
     */
    async _editMessage(chatId, messageId, text, options = {}) {
        try {
            const httpClient = this._createAxiosInstance();
            const response = await httpClient.post(`/bot${this.botToken}/editMessageText`, {
                chat_id: chatId,
                message_id: messageId,
                text: text,
                ...options
            });
            
            return response.status === 200 && response.data.ok ? response.data.result : null;
        } catch (error) {
            this.logger.warn('Failed to edit message:', error.message);
            return null;
        }
    }

    // ========== Telegram 特有的私有方法 ==========

    /**
     * 轮询循环
     */
    async _pollingLoop() {
        while (this.isPolling) {
            this.currentPolling = true;
            
            try {
                await this._pollMessages();
                
                // 成功轮询后，重置退避间隔
                this.pollingInterval = this.config.pollingInterval || 1000;
            } catch (error) {
                this.consecutiveErrors++;
                this.statistics.errors++;
                
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
                
                // 连续错误过多时，暂停轮询一段时间
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
                // 使用可中断的延迟，而不是固定的setTimeout
                await this._interruptibleDelay(this.pollingInterval);
            }
        }
    }

    /**
     * 可中断的延迟方法
     */
    async _interruptibleDelay(ms) {
        const startTime = Date.now();
        const checkInterval = 100; // 每100ms检查一次
        
        while (this.isPolling && (Date.now() - startTime) < ms) {
            await new Promise(resolve => setTimeout(resolve, Math.min(checkInterval, ms - (Date.now() - startTime))));
        }
    }

    async _pollMessages() {
        try {
            const httpClient = this._createAxiosInstance();
            
            // 保存当前实例以便在停止时可以快速取消
            this.currentAxiosInstance = httpClient;
            
            const response = await httpClient.get(`/bot${this.botToken}/getUpdates`, {
                params: {
                    offset: this.lastUpdateId + 1,
                    timeout: this.isPolling ? 30 : 1 // 如果正在停止，使用短超时
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
                throw new Error(`HTTP ${error.response.status}: ${error.response.data?.description || error.response.statusText}`);
            } else if (error.code) {
                throw new Error(this._handleNetworkError(error));
            } else {
                throw error; // 重新抛出其他错误
            }
        }
    }

    async _handleIncomingMessage(message) {
        const text = message.text?.trim();
        const chatId = message.chat.id;
        const userId = message.from.id;
        const chatType = message.chat.type; // 'private', 'group', 'supergroup', 'channel'
        const messageId = message.message_id;
        const replyToMessage = message.reply_to_message;
        
        if (!text) return;

        this.logger.info(`📨 Received ${chatType} message from ${userId} in chat ${chatId}: ${text}`);

        // 智能授权检查：支持动态私聊和预配置的群聊
        if (!this._isAuthorizedSmart(chatId, userId, chatType)) {
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

        if (text === '/status') {
            await this._sendStatusMessage(chatId);
            return;
        }


        // 新的智能命令解析逻辑
        const commandInfo = this._parseCommand(text, chatId, replyToMessage);
        
        if (commandInfo) {
            let { token, command, source } = commandInfo;
            
            // 处理没有活跃Token的情况 - 自动创建session
            if (source === 'no_active_token') {
                this.logger.info(`🔄 Auto-creating session for command: ${command}`);
                
                // 自动创建一个新的session
                const sessionId = generateUuid();
                const newToken = this._generateToken();
                
                const autoNotification = {
                    type: 'waiting',
                    title: 'Auto-Created Session',
                    message: 'Session created automatically for your command.',
                    project: 'Auto-Session',
                    metadata: {
                        userQuestion: command,
                        claudeResponse: '',
                        tmuxSession: 'auto-session',
                        autoCreated: true
                    }
                };

                // 创建session
                await this._createSession(sessionId, autoNotification, newToken);
                
                // 记录活跃token
                this.activeTokens.set(chatId, { 
                    token: newToken, 
                    timestamp: Date.now(), 
                    messageId: null,
                    sessionId 
                });
                
                this.logger.info(`✅ Auto-created session ${sessionId} with token ${newToken}`);
                
                // 更新命令信息，使用新创建的token
                token = newToken;
                source = 'auto_created';
                
                // 继续执行命令，不再返回
            }
            
            this.logger.info(`💬 Command parsed via ${source}: Token=${token}, Command="${command.substring(0, 50)}${command.length > 50 ? '...' : ''}"`);
            
            // 使用基类的 handleCommand 方法，传递增强的上下文
            const context = {
                chatId,
                userId,
                token,
                messageId,
                replyToMessageId: replyToMessage?.message_id,
                timestamp: new Date(message.date * 1000).toISOString(),
                source
            };

            await this.handleCommand(command, context);
        } else {
            // 提供更友好的帮助信息
            await this._sendHelpMessage(chatId, true);
        }
    }

    /**
     * 获取命令来源的友好描述
     */
    _getSourceDescription(source) {
        const descriptions = {
            'explicit_cmd': 'Traditional format (/cmd)',
            'token_prefix': 'Simple format (TOKEN)',
            'reply_to_bot': 'Reply to bot message',
            'active_token': 'Smart format (remembered token)'
        };
        return descriptions[source] || source;
    }

    /**
     * 智能命令解析 - 支持多种格式
     * 1. /cmd TOKEN command (传统格式)
     * 2. TOKEN command (简化格式)
     * 3. 直接回复bot消息 (reply格式)
     * 4. 直接发送命令 (使用最近Token)
     */
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

        // 格式3: 回复bot消息 (自动提取Token)
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

        // 格式4: 直接发送命令 (使用最近活跃Token)
        // 排除明显的非命令文本
        if (!this._looksLikeCommand(text)) {
            return null;
        }

        const activeToken = this.activeTokens.get(chatId);
        if (activeToken) {
            // 检查Token是否还在有效期内 (24小时)
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

        // 如果文本看起来像命令但没有活跃Token，返回特殊标记
        return {
            token: null,
            command: text,
            source: 'no_active_token'
        };
    }

    /**
     * 判断文本是否看起来像命令
     */
    _looksLikeCommand(text) {
        // 排除太短的文本
        if (text.length < 2) return false;
        
        // 排除纯符号或数字
        if (/^[\d\s\.\,\!\?\-\+\=]+$/.test(text)) return false;
        
        // 排除常见的非命令短语
        const nonCommands = [
            /^(hi|hello|hey|ok|yes|no|thanks|thx|谢谢|好的|是的|不是)$/i,
            /^[\u4e00-\u9fff]{1,2}$/,  // 只排除1-2个中文字符（如"好"、"是的"）
            /^(哈哈|呵呵|嗯|啊|哦|额)$/,  // 排除常见中文感叹词
        ];
        
        for (const pattern of nonCommands) {
            if (pattern.test(text)) return false;
        }
        
        return true;
    }

    /**
     * 智能授权检查：支持私聊和群聊的不同策略
     */
    _isAuthorizedSmart(chatId, userId, chatType) {
        // 1. 如果配置了特定的群聊 ID，只允许该群聊
        if (this.groupId && chatType !== 'private') {
            return String(chatId) === String(this.groupId);
        }
        
        // 2. 如果配置了特定的私聊 ID，只允许该用户私聊
        if (this.chatId && chatType === 'private') {
            return String(chatId) === String(this.chatId);
        }
        
        // 3. 如果只配置了 Bot Token，支持白名单用户的私聊
        if (!this.groupId && !this.chatId && chatType === 'private') {
            // 如果有白名单，检查用户 ID
            if (this.whitelist.length > 0) {
                return this.whitelist.includes(String(userId)) || this.whitelist.includes(String(chatId));
            }
            // 如果没有白名单，记录但允许（可以通过日志审计）
            this.logger.info(`🔓 Dynamic private chat authorized: ${userId} (${chatId})`);
            return true;
        }
        
        // 4. 传统授权检查兼容
        if (this.whitelist.length > 0) {
            return this.whitelist.includes(String(userId)) || this.whitelist.includes(String(chatId));
        }
        
        // 5. 默认拒绝群聊（除非明确配置）
        if (chatType !== 'private') {
            return false;
        }
        
        return true;
    }

    /**
     * 发送消息到动态聊天（支持运行时发现的聊天对象）
     */
    async _sendToDynamicChat(notification, chatId) {
        // 为动态聊天添加特殊的元数据
        const enhancedNotification = {
            ...notification,
            metadata: {
                ...notification.metadata,
                dynamicChatId: chatId,
                chatType: 'dynamic_private'
            }
        };
        
        return await this._sendImpl(enhancedNotification);
    }

    validateConfig() {
        return this._validateConfig();
    }

    async test() {
        try {
            if (!this.botToken) {
                throw new Error('Bot token is required');
            }
            
            // 如果没有配置聊天对象，提供更友好的提示
            if (!this.chatId && !this.groupId) {
                this.logger.info('💡 No specific chat configured. Bot will accept private messages from authorized users.');
            }

            // Test bot connection with enhanced error handling
            this.logger.info('🔍 Testing Telegram API connectivity...');
            if (this.proxyConfig) {
                this.logger.info(`   Using proxy: ${this.proxyConfig.host}:${this.proxyConfig.port}`);
            }
            
            try {
                const httpClient = this._createAxiosInstance();
                const response = await httpClient.get(`/bot${this.botToken}/getMe`);
                
                if (!response.data.ok) {
                    throw new Error(`Bot token invalid: ${response.data.description}`);
                }
                
                this.logger.info(`✅ Bot connected: @${response.data.result.username} (${response.data.result.first_name})`);
                
            } catch (error) {
                // 增强的网络连接诊断
                this.logger.error('❌ Telegram API connection failed:');
                this.logger.error(`   • Error: ${error.message}`);
                this.logger.error(`   • Code: ${error.code || 'N/A'}`);
                
                if (error.response) {
                    this.logger.error(`   • HTTP Status: ${error.response.status}`);
                    this.logger.error(`   • Response: ${error.response.data?.description || error.response.statusText}`);
                    throw new Error(`HTTP ${error.response.status}: ${error.response.data?.description || error.response.statusText}`);
                } else if (error.code) {
                    const networkError = this._handleNetworkError(error);
                    
                    if (this.proxyConfig) {
                        this.logger.error('   • Proxy configuration:');
                        this.logger.error(`     - Host: ${this.proxyConfig.host}`);
                        this.logger.error(`     - Port: ${this.proxyConfig.port}`);
                        this.logger.error(`     - Protocol: ${this.proxyConfig.protocol}`);
                        this.logger.error('');
                        this.logger.error('💡 Proxy troubleshooting suggestions:');
                        this.logger.error('   • Try different proxy ports (7890, 1080, 8080)');
                        this.logger.error('   • Check if proxy supports HTTPS CONNECT method');
                        this.logger.error('   • Temporarily disable proxy to test direct connection');
                        this.logger.error('   • Update proxy software to latest version');
                        this.logger.error('   • Try switching proxy mode (TUN/TAP vs HTTP)');
                    } else {
                        this.logger.error('   • This might be due to:');
                        this.logger.error('     - Firewall blocking Telegram API');
                        this.logger.error('     - Network restrictions in China/Iran/Russia');
                        this.logger.error('     - Corporate proxy settings');
                        this.logger.error('     - Internet connection issues');
                        this.logger.error('');
                        this.logger.error('💡 Possible solutions:');
                        this.logger.error('   • Configure HTTP proxy in .env:');
                        this.logger.error('     HTTP_PROXY=http://127.0.0.1:7890');
                        this.logger.error('   • Use VPN if in restricted region');
                        this.logger.error('   • Check firewall/antivirus settings');
                    }
                    
                    throw new Error(networkError);
                } else {
                    this.logger.error(`   • Full error: ${JSON.stringify(error, null, 2)}`);
                    throw error;
                }
            }

            // 如果没有聊天目标，只测试 Bot 连接
            if (!this.chatId && !this.groupId) {
                this.logger.info('✅ Bot connection validated. Ready to accept private messages.');
                this.logger.info('💡 To test message sending, start a private chat with the bot and send /start');
                return true;
            }
            
            // Send test message
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

            const result = await this._sendImpl(testNotification);
            return result;
        } catch (error) {
            this.logger.error('Telegram test failed:', error.message);
            return false;
        }
    }

    getStatus() {
        const baseStatus = super.getStatus();
        
        // 智能配置状态：支持仅 Bot Token 的配置
        const configStatus = this.botToken ? 
            (this.chatId || this.groupId ? 'fully_configured' : 'bot_only') : 
            'not_configured';
            
        // 网络连接状态评估
        const networkStatus = this.consecutiveErrors === 0 ? 'connected' :
                            this.consecutiveErrors < this.maxConsecutiveErrors ? 'unstable' :
                            'disconnected';
            
        return {
            ...baseStatus,
            configured: this.validateConfig(),
            supportsRelay: true,
            configStatus,
            networkStatus,
            botToken: this.botToken ? 'configured' : 'not configured',
            chatId: this.chatId || 'not configured',
            groupId: this.groupId || 'not configured',
            supportsModes: {
                privateChat: true,
                groupChat: !!this.groupId,
                dynamicChat: !this.chatId && !this.groupId && this.botToken
            },
            whitelist: this.whitelist.length,
            polling: this.isPolling,
            consecutiveErrors: this.consecutiveErrors,
            currentPollingInterval: this.pollingInterval,
            maxConsecutiveErrors: this.maxConsecutiveErrors
        };
    }
    
    // ========== 私有辅助方法 ==========
    
    async _sendMessage(chatId, text, options = {}) {
        try {
            const httpClient = this._createAxiosInstance();
            
            // 记录发送尝试
            this.logger.debug(`📤 Sending message to ${chatId} (${text.length} chars)`);
            
            const response = await httpClient.post(`/bot${this.botToken}/sendMessage`, {
                chat_id: chatId,
                text: text,
                ...options
            });
            
            if (response.status === 200 && response.data.ok) {
                const messageId = response.data.result.message_id;
                this.logger.debug(`✅ Message sent successfully, ID: ${messageId}`);
                return response.data.result; // 返回消息对象，包含message_id
            } else {
                this.logger.warn(`⚠️ Telegram API returned non-success status: ${response.status}, ok: ${response.data.ok}`);
                this.logger.warn(`API response: ${JSON.stringify(response.data)}`);
                return false;
            }
        } catch (error) {
            // 详细错误处理
            let errorDetails = error.message;
            
            if (error.response) {
                // HTTP错误响应
                const status = error.response.status;
                const data = error.response.data;
                
                errorDetails = `HTTP ${status}: ${data?.description || data?.error || 'Unknown error'}`;
                
                // 特殊处理常见的Telegram API错误
                if (status === 429) {
                    errorDetails += ' (Rate limit exceeded)';
                } else if (status === 403) {
                    errorDetails += ' (Forbidden - check bot permissions)';
                } else if (status === 400) {
                    errorDetails += ' (Bad request - check message format)';
                }
                
                this.logger.error(`❌ Telegram API error: ${errorDetails}`);
                this.logger.debug(`Error response:`, JSON.stringify(error.response.data, null, 2));
            } else if (error.code) {
                // 网络错误
                errorDetails = `Network error (${error.code}): ${error.message}`;
                this.logger.error(`❌ Network error: ${errorDetails}`);
            } else {
                // 其他错误
                this.logger.error(`❌ Failed to send message: ${errorDetails}`);
            }
            
            return false;
        }
    }
    
    async _sendWelcomeMessage(chatId) {
        const welcomeText = `👋 *Welcome to Claude-Code-Remote Bot!*\n\n` +
            `This bot helps you remotely control Claude Code sessions.\n\n` +
            `*Available Commands:*\n` +
            `• \`/help\` - Show detailed help\n` +
            `• \`/status\` - Show bot status\n` +
            `• Multiple command formats supported!\n\n` +
            `*🚀 New! Multiple Ways to Send Commands:*\n` +
            `1️⃣ Traditional: \`/cmd TOKEN command\`\n` +
            `2️⃣ Simple: \`TOKEN command\`\n` +
            `3️⃣ Reply: Reply to bot messages directly\n` +
            `4️⃣ Smart: Just send command (uses recent token)\n\n` +
            `*How it works:*\n` +
            `1. Start Claude Code in a tmux session\n` +
            `2. You'll receive notifications with session tokens\n` +
            `3. Use any of the 4 formats above to send commands\n` +
            `4. Commands are executed automatically\n\n` +
            `🔒 Bot configured for: ${
                this.groupId ? 'Group chat' : 
                this.chatId ? 'Private chat' : 
                'Dynamic private chats'
            }`;
            
        await this._sendMessage(chatId, welcomeText, { parse_mode: 'Markdown' });
    }

    async _handleStartCommand(chatId) {
        // 清理该聊天的旧Token和会话记录
        await this._cleanupChatHistory(chatId);
        
        // 生成新的Token和会话
        const sessionId = generateUuid();
        const token = this._generateToken();
        
        const welcomeNotification = {
            type: 'completed',
            title: 'Welcome to Claude-Code-Remote!',
            message: 'Your personal Claude command session is ready.',
            project: 'Welcome',
            metadata: {
                userQuestion: 'Welcome to Claude-Code-Remote Bot',
                claudeResponse: 'I\'m ready to help you with your development tasks!',
                tmuxSession: 'welcome-session',
                isWelcomeSession: true
            }
        };

        // 创建欢迎会话
        await this._createSession(sessionId, welcomeNotification, token);

        // 生成欢迎消息
        const messageText = `👋 *Welcome to Claude-Code-Remote Bot!*\n\n` +
            `🎉 *Your session is ready!*\n` +
            `*Token:* \`${token}\`\n\n` +
            `🚀 *Try these commands now:*\n` +
            `• Just reply to this message\n` +
            `• Send: \`${token} help me write a function\`\n` +
            `• Simply send: \`what can you do?\`\n\n` +
            `*🎯 Four Ways to Send Commands:*\n` +
            `1️⃣ Traditional: \`/cmd ${token} command\`\n` +
            `2️⃣ Simple: \`${token} command\`\n` +
            `3️⃣ Reply: Reply to this message directly\n` +
            `4️⃣ Smart: Just send your command\n\n` +
            `💡 *Pro Tip: I'll remember your token, so you can just chat normally!*\n\n` +
            `Use \`/help\` for detailed instructions or \`/start\` to reset your session.`;
        
        try {
            const httpClient = this._createAxiosInstance();
            const response = await httpClient.post(`/bot${this.botToken}/sendMessage`, {
                chat_id: chatId,
                text: messageText,
                parse_mode: 'Markdown',
                reply_markup: {
                    inline_keyboard: [[
                        {
                            text: '💬 Try Replying Here!',
                            callback_data: `session:${token}`
                        },
                        {
                            text: '❓ Help',
                            callback_data: 'help'
                        }
                    ]]
                }
            });

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
                
                this.logger.info(`✅ Welcome session created for chat ${chatId}, Token: ${token}`);
            }
        } catch (error) {
            this.logger.error('Failed to create welcome session:', error.message);
            // 回退到简单欢迎消息
            await this._sendWelcomeMessage(chatId);
        }
    }

    async _cleanupChatHistory(chatId) {
        try {
            // 清理活跃Token
            const oldToken = this.activeTokens.get(chatId);
            if (oldToken) {
                this.activeTokens.delete(chatId);
                
                // 清理相关的消息映射
                if (oldToken.messageId) {
                    this.tokenMessageMap.delete(oldToken.messageId);
                }
                
                // 删除旧的会话文件
                if (oldToken.sessionId) {
                    const sessionFile = path.join(this.sessionsDir, `${oldToken.sessionId}.json`);
                    if (fs.existsSync(sessionFile)) {
                        fs.unlinkSync(sessionFile);
                        this.logger.debug(`Cleaned up old session: ${oldToken.sessionId}`);
                    }
                }
            }
            
            // 清理该聊天相关的所有Token映射
            for (const [messageId, tokenInfo] of this.tokenMessageMap.entries()) {
                // 注意：这里需要通过其他方式识别聊天，因为tokenMessageMap没有直接存储chatId
                // 我们可以通过会话文件来判断
                if (tokenInfo.sessionId) {
                    const sessionFile = path.join(this.sessionsDir, `${tokenInfo.sessionId}.json`);
                    if (fs.existsSync(sessionFile)) {
                        try {
                            const sessionData = JSON.parse(fs.readFileSync(sessionFile, 'utf8'));
                            if (sessionData.chatId === chatId) {
                                this.tokenMessageMap.delete(messageId);
                                fs.unlinkSync(sessionFile);
                                this.logger.debug(`Cleaned up session: ${tokenInfo.sessionId}`);
                            }
                        } catch (error) {
                            // 忽略解析错误，直接删除
                            this.tokenMessageMap.delete(messageId);
                        }
                    }
                }
            }
            
            this.logger.info(`🧹 Cleaned up chat history for ${chatId}`);
        } catch (error) {
            this.logger.error('Error cleaning up chat history:', error.message);
        }
    }
    
    async _sendHelpMessage(chatId, showError = false) {
        let helpText = '';
        
        if (showError) {
            helpText += `❌ *Command not recognized*\n\n`;
        }
        
        helpText += `🆘 *Claude-Code-Remote Bot Help*\n\n` +
            `*🎯 Four Ways to Send Commands:*\n\n` +
            
            `*1️⃣ Traditional Format:*\n` +
            `\`/cmd TOKEN command\`\n` +
            `Example: \`/cmd ABC12345 analyze this code\`\n\n` +
            
            `*2️⃣ Simple Format:*\n` +
            `\`TOKEN command\`\n` +
            `Example: \`XYZ89012 create a new function\`\n\n` +
            
            `*3️⃣ Reply Format (NEW!):*\n` +
            `Reply directly to any bot message\n` +
            `Example: Reply with \`refactor the main module\`\n\n` +
            
            `*4️⃣ Smart Format (NEW!):*\n` +
            `Just send your command (uses recent token)\n` +
            `Example: Just type \`fix the bug in login\`\n\n` +
            
            `*📝 Token Info:*\n` +
            `• Tokens are 8-character codes (letters + numbers)\n` +
            `• Each token is valid for 24 hours\n` +
            `• Bot remembers your recent token for easy commands\n\n` +
            
            `*🛠️ Other Commands:*\n` +
            `• \`/start\` - Create new session & reset chat\n` +
            `• \`/help\` - This help message\n` +
            `• \`/status\` - Bot configuration status\n\n` +
            
            `*💡 Pro Tips:*\n` +
            `• After receiving a notification, you can simply reply to it\n` +
            `• Or just send commands directly - bot remembers your token\n` +
            `• Use traditional format if you have multiple active sessions`;
            
        await this._sendMessage(chatId, helpText, { parse_mode: 'Markdown' });
    }

    async _createTestSession(chatId) {
        // 创建一个测试会话，让用户体验智能命令功能
        const sessionId = generateUuid();
        const token = this._generateToken();
        
        const testNotification = {
            type: 'completed',
            title: 'Test Session',
            message: 'This is a test session to demonstrate smart command features.',
            project: 'Demo',
            metadata: {
                userQuestion: 'Demo question',
                claudeResponse: 'Demo response',
                tmuxSession: 'demo'
            }
        };

        // 创建测试会话文件
        await this._createSession(sessionId, testNotification, token);

        // 生成并发送测试消息
        const messageText = this._generateTelegramMessage(testNotification, sessionId, token);
        
        try {
            const httpClient = this._createAxiosInstance();
            const response = await httpClient.post(`/bot${this.botToken}/sendMessage`, {
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
            });

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
                
                // 发送说明消息
                await this._sendMessage(chatId, 
                    `🎉 *Test session created!*\n\n` +
                    `Now you can try:\n` +
                    `• Reply to the message above\n` +
                    `• Send: \`${token} test command\`\n` +
                    `• Just send: \`test command\`\n\n` +
                    `Note: This is just a demo - commands won't actually execute.`,
                    { parse_mode: 'Markdown' });
            }
        } catch (error) {
            await this._sendMessage(chatId, 
                `❌ Failed to create test session: ${error.message}`);
        }
    }
    
    async _sendStatusMessage(chatId) {
        const status = this.getStatus();
        const statusText = `📊 *Bot Status*\n\n` +
            `*Configuration:*\n` +
            `• Status: ${status.configStatus === 'fully_configured' ? '✅ Fully configured' : 
                         status.configStatus === 'bot_only' ? '🟡 Bot only (dynamic chats)' : 
                         '❌ Not configured'}\n` +
            `• Bot Token: ${status.botToken}\n` +
            `• Private Chat: ${status.chatId !== 'not configured' ? status.chatId : 'Dynamic'}\n` +
            `• Group Chat: ${status.groupId}\n` +
            `• Whitelist: ${status.whitelist} users\n\n` +
            `*Capabilities:*\n` +
            `• Private Chat: ${status.supportsModes.privateChat ? '✅' : '❌'}\n` +
            `• Group Chat: ${status.supportsModes.groupChat ? '✅' : '❌'}\n` +
            `• Dynamic Chat: ${status.supportsModes.dynamicChat ? '✅' : '❌'}\n\n` +
            `*Monitoring:*\n` +
            `• Polling: ${status.polling ? '✅ Active' : '❌ Inactive'}\n` +
            `• Messages: ${status.messageCount || 0}\n` +
            `• Errors: ${status.errorCount || 0}`;
            
        await this._sendMessage(chatId, statusText, { parse_mode: 'Markdown' });
    }
    
    async _findSessionByToken(token) {
        try {
            const sessionFiles = require('fs').readdirSync(this.sessionsDir).filter(f => f.endsWith('.json'));
            
            for (const file of sessionFiles) {
                const sessionPath = require('path').join(this.sessionsDir, file);
                const session = JSON.parse(require('fs').readFileSync(sessionPath, 'utf8'));
                
                if (session.token === token) {
                    return session;
                }
            }
            
            return null;
        } catch (error) {
            this.logger.error('Error finding session by token:', error.message);
            return null;
        }
    }
}

module.exports = TelegramChannel;