/**
 * Enhanced Base Notification Channel
 * Abstract base class for all notification channels with multi-channel support
 */

const Logger = require('../../core/logger');
const EventEmitter = require('events');

class NotificationChannel extends EventEmitter {
    constructor(name, config = {}) {
        super();
        this.name = name;
        this.type = this._getChannelType(name);
        this.config = config;
        this.logger = new Logger(`Channel:${name}`);
        this.enabled = config.enabled !== false;
        
        // 扩展属性
        this.capabilities = this._defineCapabilities();
        this.connectionStatus = 'disconnected';
        this.lastActivity = null;
        this.statistics = {
            messagesSent: 0,
            messagesReceived: 0,
            errors: 0,
            uptime: 0
        };
        
        this.startTime = null;
    }

    /**
     * 获取频道类型 (用于路由识别)
     */
    _getChannelType(name) {
        // 从名称推断类型，子类可以重写
        if (name.includes('telegram')) return 'telegram';
        if (name.includes('email') || name.includes('smtp')) return 'email';
        if (name.includes('discord')) return 'discord';
        if (name.includes('line')) return 'line';
        if (name.includes('desktop')) return 'desktop';
        return name.toLowerCase();
    }

    /**
     * 定义频道能力 (子类应重写)
     */
    _defineCapabilities() {
        return {
            canSend: true,           // 可以发送通知
            canReceive: false,       // 可以接收命令
            supportsRelay: false,    // 支持命令中继
            supportsPolling: false,  // 支持轮询监听
            supportsWebhook: false,  // 支持 Webhook
            supportsFiles: false,    // 支持文件传输
            supportsMarkdown: false, // 支持 Markdown
            requiresAuth: false,     // 需要认证
            hasPresence: false       // 有在线状态
        };
    }

    /**
     * Send a notification with enhanced tracking
     * @param {Object} notification - Notification object
     * @returns {Promise<boolean>} Success status
     */
    async send(notification) {
        if (!this.enabled) {
            this.logger.debug('Channel disabled, skipping notification');
            return false;
        }

        this.logger.debug('Sending notification:', notification.type);
        this._updateActivity();
        
        try {
            const result = await this._sendImpl(notification);
            
            if (result) {
                this.statistics.messagesSent++;
                this.logger.info(`✅ Notification sent via ${this.type}: ${notification.type}`);
                this.emit('messageSent', { notification, channel: this.type });
            } else {
                this.statistics.errors++;
                this.logger.warn(`❌ Failed to send via ${this.type}: ${notification.type}`);
                this.emit('sendFailed', { notification, channel: this.type });
            }
            
            return result;
        } catch (error) {
            this.statistics.errors++;
            this.logger.error('Error sending notification:', error.message);
            this.emit('error', error);
            return false;
        }
    }

    /**
     * 启动频道监听 (如果支持)
     * @returns {Promise<void>}
     */
    async startListening() {
        if (!this.capabilities.canReceive) {
            this.logger.debug(`${this.type} channel does not support receiving messages`);
            return;
        }

        if (this.connectionStatus === 'connected') {
            this.logger.warn(`${this.type} listener already running`);
            return;
        }

        this.logger.info(`🎧 Starting ${this.type} listener...`);
        this.startTime = new Date();
        
        try {
            await this._startListeningImpl();
            this.connectionStatus = 'connected';
            this.logger.info(`✅ ${this.type} listener started successfully`);
            this.emit('listenerStarted', this.type);
        } catch (error) {
            this.connectionStatus = 'error';
            this.logger.error(`❌ Failed to start ${this.type} listener:`, error);
            this.emit('listenerError', { type: this.type, error });
            throw error;
        }
    }

    /**
     * 停止频道监听
     * @returns {Promise<void>}
     */
    async stopListening() {
        if (this.connectionStatus !== 'connected') {
            this.logger.debug(`${this.type} listener not running`);
            return;
        }

        this.logger.info(`🔇 Stopping ${this.type} listener...`);
        
        try {
            await this._stopListeningImpl();
            this.connectionStatus = 'disconnected';
            this._updateUptime();
            this.logger.info(`✅ ${this.type} listener stopped`);
            this.emit('listenerStopped', this.type);
        } catch (error) {
            this.logger.error(`❌ Error stopping ${this.type} listener:`, error);
            this.emit('listenerError', { type: this.type, error });
        }
    }

    /**
     * 创建会话时的来源信息
     * @param {Object} sessionData - 基础会话数据
     * @returns {Object} 增强的会话数据
     */
    createSessionWithOrigin(sessionData) {
        return {
            ...sessionData,
            origin: this.type,           // 来源频道类型
            channelType: this.type,      // 兼容旧字段
            channelName: this.name,      // 频道实例名
            sourceMetadata: {
                capabilities: this.capabilities,
                connectionStatus: this.connectionStatus,
                timestamp: new Date().toISOString()
            }
        };
    }

    /**
     * 更新活动时间
     */
    _updateActivity() {
        this.lastActivity = new Date();
    }

    /**
     * 更新运行时间统计
     */
    _updateUptime() {
        if (this.startTime) {
            this.statistics.uptime += Date.now() - this.startTime.getTime();
            this.startTime = null;
        }
    }

    /**
     * Test the channel configuration
     * @returns {Promise<boolean>} Test success status
     */
    async test() {
        this.logger.debug('Testing channel...');
        
        const testNotification = {
            type: 'completed',
            title: 'Claude-Code-Remote Test',
            message: `Test notification from ${this.name} channel`,
            project: 'test-project',
            metadata: { test: true }
        };

        return await this.send(testNotification);
    }

    /**
     * Check if the channel supports command relay (deprecated - use capabilities)
     * @returns {boolean} Support status
     */
    supportsRelay() {
        return this.capabilities.supportsRelay;
    }

    /**
     * Handle incoming command from this channel
     * @param {string} command - Command to execute
     * @param {Object} context - Command context
     * @returns {Promise<boolean>} Success status
     */
    async handleCommand(command, context = {}) {
        if (!this.capabilities.canReceive) {
            this.logger.warn(`${this.type} channel does not support receiving commands`);
            return false;
        }

        this._updateActivity();
        this.statistics.messagesReceived++;
        
        this.logger.info(`📨 Command received via ${this.type}: ${command.substring(0, 50)}...`);
        
        // 增强上下文信息
        const enhancedContext = {
            ...context,
            channelType: this.type,
            channelName: this.name,
            receivedAt: new Date().toISOString(),
            capabilities: this.capabilities
        };

        try {
            const result = await this._handleCommandImpl(command, enhancedContext);
            
            if (result) {
                this.emit('commandProcessed', { command, context: enhancedContext, success: true });
            } else {
                this.emit('commandFailed', { command, context: enhancedContext, reason: 'Handler returned false' });
            }
            
            return result;
        } catch (error) {
            this.statistics.errors++;
            this.logger.error(`Error handling command via ${this.type}:`, error);
            this.emit('commandFailed', { command, context: enhancedContext, error });
            return false;
        }
    }

    // ========== 抽象方法 - 子类必须实现 ==========

    /**
     * Implementation-specific send logic
     * Must be implemented by subclasses
     * @param {Object} notification - Notification object
     * @returns {Promise<boolean>} Success status
     */
    async _sendImpl(notification) {
        throw new Error(`_sendImpl must be implemented by ${this.constructor.name}`);
    }

    /**
     * Implementation-specific listening logic
     * Should be implemented by subclasses that support receiving messages
     * @returns {Promise<void>}
     */
    async _startListeningImpl() {
        if (this.capabilities.canReceive) {
            throw new Error(`_startListeningImpl must be implemented by ${this.constructor.name} (supports receiving)`);
        }
        // Default: no-op for send-only channels
    }

    /**
     * Implementation-specific stop listening logic
     * Should be implemented by subclasses that support receiving messages
     * @returns {Promise<void>}
     */
    async _stopListeningImpl() {
        if (this.capabilities.canReceive) {
            throw new Error(`_stopListeningImpl must be implemented by ${this.constructor.name} (supports receiving)`);
        }
        // Default: no-op for send-only channels
    }

    /**
     * Implementation-specific command handling logic
     * Should be implemented by subclasses that support command relay
     * @param {string} command - Command to execute
     * @param {Object} context - Enhanced command context
     * @returns {Promise<boolean>} Success status
     */
    async _handleCommandImpl(command, context) {
        if (this.capabilities.supportsRelay) {
            throw new Error(`_handleCommandImpl must be implemented by ${this.constructor.name} (supports relay)`);
        }
        return false;
    }

    // ========== 配置和状态方法 ==========

    /**
     * Validate channel configuration
     * Can be overridden by subclasses
     * @returns {boolean} Validation status
     */
    validateConfig() {
        return true;
    }

    /**
     * Get enhanced channel status
     * @returns {Object} Comprehensive status information
     */
    getStatus() {
        return {
            name: this.name,
            type: this.type,
            enabled: this.enabled,
            configured: this.validateConfig(),
            connectionStatus: this.connectionStatus,
            capabilities: this.capabilities,
            lastActivity: this.lastActivity,
            statistics: { ...this.statistics },
            uptime: this._calculateCurrentUptime(),
            // 兼容旧接口
            supportsRelay: this.capabilities.supportsRelay
        };
    }

    /**
     * 计算当前运行时间
     * @returns {number} 运行时间（毫秒）
     */
    _calculateCurrentUptime() {
        let currentUptime = this.statistics.uptime;
        if (this.startTime && this.connectionStatus === 'connected') {
            currentUptime += Date.now() - this.startTime.getTime();
        }
        return currentUptime;
    }

    /**
     * 重置统计信息
     */
    resetStatistics() {
        this.statistics = {
            messagesSent: 0,
            messagesReceived: 0,
            errors: 0,
            uptime: 0
        };
        this.startTime = this.connectionStatus === 'connected' ? new Date() : null;
        this.logger.info(`${this.type} statistics reset`);
    }
}

module.exports = NotificationChannel;