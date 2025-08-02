/**
 * Multi-Channel Manager
 * 统一的多渠道监听和路由管理器
 * 
 * 核心功能：
 * 1. 多渠道并发监听 (Email + Telegram + LINE + Discord 等)
 * 2. 智能来源路由 (根据会话来源自动回复到原始渠道)
 * 3. 频道生命周期管理 (启动、停止、错误处理)
 * 4. 动态频道注册 (方便扩展新渠道)
 */

const Logger = require('./logger');
const EventEmitter = require('events');

class ChannelManager extends EventEmitter {
    constructor(config) {
        super();
        this.logger = new Logger('ChannelManager');
        this.config = config;
        
        // 频道注册表
        this.channels = new Map();           // 所有已注册的频道
        this.listeners = new Map();          // 正在监听的频道
        this.sessionRouter = new SessionRouter();
        
        // 监听状态
        this.isListening = false;
        this.startTime = null;
        
        this.logger.info('Multi-channel manager initialized');
    }

    /**
     * 注册频道
     * @param {string} channelType - 频道类型 (email, telegram, line, discord)
     * @param {NotificationChannel} channelInstance - 频道实例
     * @param {Object} listenerConfig - 监听器配置
     */
    registerChannel(channelType, channelInstance, listenerConfig = {}) {
        if (this.channels.has(channelType)) {
            this.logger.warn(`Channel ${channelType} already registered, overwriting`);
        }

        const channelInfo = {
            type: channelType,
            instance: channelInstance,
            listenerConfig,
            status: 'registered',
            lastActivity: null,
            messageCount: 0,
            errorCount: 0
        };

        this.channels.set(channelType, channelInfo);
        this.logger.info(`Channel registered: ${channelType}`);
        
        // 如果已经在监听中，自动启动新注册的频道
        if (this.isListening && channelInstance.enabled) {
            this._startChannelListener(channelType);
        }

        this.emit('channelRegistered', channelType, channelInfo);
    }

    /**
     * 启动所有频道监听
     */
    async startListening() {
        if (this.isListening) {
            this.logger.warn('Already listening, ignoring start request');
            return;
        }

        this.logger.info('🚀 Starting multi-channel listening...');
        this.isListening = true;
        this.startTime = new Date();

        const enabledChannels = Array.from(this.channels.entries())
            .filter(([type, info]) => info.instance.enabled);

        if (enabledChannels.length === 0) {
            this.logger.warn('No enabled channels found');
            return;
        }

        // 并发启动所有已启用的频道监听
        const startPromises = enabledChannels.map(([type]) => 
            this._startChannelListener(type)
        );

        const results = await Promise.allSettled(startPromises);
        
        let successCount = 0;
        results.forEach((result, index) => {
            const [channelType] = enabledChannels[index];
            if (result.status === 'fulfilled') {
                successCount++;
                this.logger.info(`✅ ${channelType} listener started`);
            } else {
                this.logger.error(`❌ ${channelType} listener failed:`, result.reason);
            }
        });

        this.logger.info(`🎯 Multi-channel listening started: ${successCount}/${enabledChannels.length} channels active`);
        this.emit('listeningStarted', successCount, enabledChannels.length);
    }

    /**
     * 停止所有频道监听
     */
    async stopListening() {
        if (!this.isListening) {
            this.logger.warn('Not currently listening, ignoring stop request');
            return;
        }

        this.logger.info('⏹️ Stopping multi-channel listening...');
        this.isListening = false;

        // 并发停止所有监听器
        const stopPromises = Array.from(this.listeners.keys()).map(type =>
            this._stopChannelListener(type)
        );

        await Promise.allSettled(stopPromises);
        
        this.logger.info('🔚 Multi-channel listening stopped');
        this.emit('listeningStopped');
    }

    /**
     * 启动单个频道监听
     */
    async _startChannelListener(channelType) {
        const channelInfo = this.channels.get(channelType);
        if (!channelInfo) {
            throw new Error(`Channel ${channelType} not registered`);
        }

        if (this.listeners.has(channelType)) {
            this.logger.warn(`${channelType} listener already running`);
            return;
        }

        try {
            const { instance, listenerConfig } = channelInfo;
            
            // 创建监听器包装器
            const listener = this._createChannelListener(channelType, instance, listenerConfig);
            
            this.listeners.set(channelType, listener);
            channelInfo.status = 'listening';
            
            // 启动监听器
            await listener.start();
            
            this.logger.info(`🎧 ${channelType} listener started successfully`);
            
        } catch (error) {
            channelInfo.status = 'error';
            channelInfo.errorCount++;
            this.logger.error(`Failed to start ${channelType} listener:`, error);
            throw error;
        }
    }

    /**
     * 停止单个频道监听
     */
    async _stopChannelListener(channelType) {
        const listener = this.listeners.get(channelType);
        const channelInfo = this.channels.get(channelType);

        if (!listener || !channelInfo) {
            return;
        }

        try {
            await listener.stop();
            this.listeners.delete(channelType);
            channelInfo.status = 'stopped';
            
            this.logger.info(`🔇 ${channelType} listener stopped`);
            
        } catch (error) {
            this.logger.error(`Error stopping ${channelType} listener:`, error);
        }
    }

    /**
     * 创建频道监听器包装器
     */
    _createChannelListener(channelType, channelInstance, config) {
        return {
            start: async () => {
                // 设置消息处理器
                this._setupMessageHandler(channelType, channelInstance);
                
                // 启动频道特定的监听逻辑
                if (channelInstance.startListening) {
                    await channelInstance.startListening();
                } else if (channelType === 'email') {
                    // Email 使用 IMAP 监听
                    await this._startEmailListener(channelInstance, config);
                } else if (channelType === 'telegram') {
                    // Telegram 使用轮询
                    await this._startTelegramListener(channelInstance, config);
                }
                // 更多渠道类型...
            },

            stop: async () => {
                if (channelInstance.stopListening) {
                    await channelInstance.stopListening();
                }
                // 清理监听器特定资源
            }
        };
    }

    /**
     * 设置消息处理器
     */
    _setupMessageHandler(channelType, channelInstance) {
        // 拦截频道的消息处理，添加来源追踪
        const originalHandler = channelInstance.handleCommand || (() => {});
        
        channelInstance.handleCommand = async (command, context = {}) => {
            // 增强上下文信息
            const enhancedContext = {
                ...context,
                channelType,
                timestamp: new Date().toISOString(),
                messageId: this._generateMessageId(channelType)
            };

            // 记录活动
            const channelInfo = this.channels.get(channelType);
            if (channelInfo) {
                channelInfo.lastActivity = new Date();
                channelInfo.messageCount++;
            }

            this.logger.info(`📨 Command received from ${channelType}: ${command.substring(0, 50)}...`);
            
            // 触发全局事件
            this.emit('commandReceived', {
                channelType,
                command,
                context: enhancedContext
            });

            // 调用原始处理器
            return await originalHandler.call(channelInstance, command, enhancedContext);
        };
    }

    /**
     * 根据会话来源路由通知
     * @param {Object} session - 会话信息
     * @param {Object} notification - 通知内容
     */
    async routeNotification(session, notification) {
        const originChannel = session.origin || session.channelType || 'all';
        
        this.logger.info(`🎯 Routing notification to origin: ${originChannel}`);

        if (originChannel === 'all') {
            // 发送到所有启用的频道
            return await this._broadcastNotification(notification);
        }

        // 发送到指定的原始频道
        const channelInfo = this.channels.get(originChannel);
        if (!channelInfo || !channelInfo.instance.enabled) {
            this.logger.warn(`Origin channel ${originChannel} not available, broadcasting to all`);
            return await this._broadcastNotification(notification);
        }

        try {
            // 发送到原始频道 + 桌面通知
            const results = {};
            
            // 原始频道
            results[originChannel] = await channelInfo.instance.send(notification);
            
            // 桌面通知（如果不是原始频道）
            if (originChannel !== 'desktop') {
                const desktopChannel = this.channels.get('desktop');
                if (desktopChannel && desktopChannel.instance.enabled) {
                    results.desktop = await desktopChannel.instance.send(notification);
                }
            }

            this.logger.info(`✅ Notification routed to ${originChannel} successfully`);
            return { success: true, results, targetChannel: originChannel };

        } catch (error) {
            this.logger.error(`Failed to route to ${originChannel}:`, error);
            // 失败时广播到所有频道
            return await this._broadcastNotification(notification);
        }
    }

    /**
     * 广播通知到所有频道
     */
    async _broadcastNotification(notification) {
        const enabledChannels = Array.from(this.channels.entries())
            .filter(([type, info]) => info.instance.enabled);

        const promises = enabledChannels.map(async ([type, info]) => {
            try {
                const success = await info.instance.send(notification);
                return { type, success };
            } catch (error) {
                this.logger.error(`Broadcast to ${type} failed:`, error);
                return { type, success: false, error: error.message };
            }
        });

        const results = await Promise.allSettled(promises);
        const processedResults = {};
        
        results.forEach((result, index) => {
            const [channelType] = enabledChannels[index];
            if (result.status === 'fulfilled') {
                processedResults[channelType] = result.value;
            } else {
                processedResults[channelType] = { success: false, error: result.reason };
            }
        });

        const successCount = Object.values(processedResults).filter(r => r.success).length;
        
        return {
            success: successCount > 0,
            results: processedResults,
            targetChannel: 'all'
        };
    }

    /**
     * 启动邮件监听器
     */
    async _startEmailListener(channelInstance, config) {
        // 这里可以集成现有的 email-listener 逻辑
        this.logger.info('📧 Email listener implementation needed');
    }

    /**
     * 启动 Telegram 监听器
     */
    async _startTelegramListener(channelInstance, config) {
        // 这里可以集成现有的 telegram polling 逻辑
        this.logger.info('📱 Telegram listener implementation needed');
    }

    /**
     * 生成消息 ID
     */
    _generateMessageId(channelType) {
        return `${channelType}_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    }

    /**
     * 获取所有频道状态
     */
    getChannelStatus() {
        const status = {
            isListening: this.isListening,
            startTime: this.startTime,
            channels: {},
            summary: {
                registered: this.channels.size,
                listening: this.listeners.size,
                totalMessages: 0,
                totalErrors: 0
            }
        };

        for (const [type, info] of this.channels) {
            status.channels[type] = {
                status: info.status,
                enabled: info.instance.enabled,
                lastActivity: info.lastActivity,
                messageCount: info.messageCount,
                errorCount: info.errorCount,
                supportsRelay: info.instance.supportsRelay?.() || false
            };

            status.summary.totalMessages += info.messageCount;
            status.summary.totalErrors += info.errorCount;
        }

        return status;
    }
}

/**
 * 会话路由器
 * 负责根据会话来源信息进行智能路由
 */
class SessionRouter {
    constructor() {
        this.logger = new Logger('SessionRouter');
    }

    /**
     * 分析会话来源
     * @param {Object} session - 会话对象
     * @returns {Object} 路由信息
     */
    analyzeSessionOrigin(session) {
        const routing = {
            originalChannel: session.origin || session.channelType || 'unknown',
            targetChannels: [],
            routingStrategy: 'origin-based'
        };

        // 根据来源确定目标频道
        switch (routing.originalChannel) {
            case 'email':
                routing.targetChannels = ['email', 'desktop'];
                break;
            case 'telegram':
                routing.targetChannels = ['telegram', 'desktop'];
                break;
            case 'line':
                routing.targetChannels = ['line', 'desktop'];
                break;
            case 'discord':
                routing.targetChannels = ['discord', 'desktop'];
                break;
            default:
                routing.targetChannels = ['desktop']; // 未知来源只发送桌面通知
                routing.routingStrategy = 'fallback';
        }

        return routing;
    }
}

module.exports = ChannelManager;