# 开发指南 (Development Guide)

这个文档为开发者提供了 Claude-Code-Remote 的架构信息和开发指导。

## 📋 目录

- [项目架构](#项目架构)
- [开发命令](#开发命令)
- [添加新渠道](#添加新渠道)
- [测试和调试](#测试和调试)
- [部署指南](#部署指南)

## 🏗️ 项目架构

### 核心组件

```
src/
├── core/                    # 核心系统组件
│   ├── multi-channel-service.js  # 多渠道统一服务
│   ├── channel-manager.js        # 渠道管理器  
│   ├── notifier.js              # 智能通知分发
│   ├── config.js               # 配置管理
│   └── logger.js               # 日志系统
├── channels/               # 通讯渠道实现
│   ├── base/channel.js          # 渠道基类
│   ├── chat/telegram.js         # Telegram 实现
│   ├── email/smtp.js            # Email 实现
│   ├── local/desktop.js         # 桌面通知
│   └── templates/               # 新渠道模板
├── relay/                  # 命令中继和注入
│   ├── relay-pty.js            # 主中继服务
│   ├── email-listener.js       # IMAP 监听
│   ├── tmux-injector.js        # Tmux 命令注入
│   └── smart-injector.js       # 智能注入器
├── data/                   # 运行时数据
│   ├── sessions/               # 会话文件
│   ├── session-map.json        # 会话映射
│   └── processed-messages.json # 消息记录
└── utils/                  # 工具函数
    ├── tmux-monitor.js         # Tmux 监控
    └── conversation-tracker.js # 对话追踪
```

### 数据流向

1. **通知流程**:
   ```
   Claude Hook → CLI → MultiChannelService → ChannelManager → 各渠道
   ```

2. **命令流程**:
   ```
   用户命令 → 渠道监听 → 会话验证 → TmuxInjector → Claude 执行
   ```

3. **智能路由**:
   ```
   会话来源记录 → 通知路由 → 原始渠道 + 桌面通知
   ```

## 🛠️ 开发命令

### 基本开发流程

```bash
# 安装依赖
npm install

# 启动多渠道服务（开发模式）
npm start

# 查看配置状态
npm run multichannel:status

# 运行测试
npm test

# 配置管理
node src/config-manager.js
```

### 调试和测试

```bash
# 测试特定渠道
npm run telegram:test

# 查看系统状态
node claude-remote.js status

# 调试模式启动
LOG_LEVEL=debug npm start

# 测试命令注入
node claude-remote.js test-simple "echo test"
```

### 服务管理

```bash
# 后台守护进程
npm run daemon:start
npm run daemon:stop
npm run daemon:status

# 单独启动组件
npm run relay:pty        # 仅 Email 中继
npm run telegram:polling # 仅 Telegram 轮询
```

## 🔌 添加新渠道

### 1. 复制模板

```bash
cp src/channels/templates/channel-template.js src/channels/chat/discord.js
```

### 2. 实现核心方法

```javascript
class DiscordChannel extends NotificationChannel {
    constructor(config = {}) {
        super('discord', config);
        // 初始化配置
    }

    _defineCapabilities() {
        return {
            canSend: true,
            canReceive: true, 
            supportsRelay: true,
            supportsWebhook: true,
            // ... 更多能力
        };
    }

    async _sendImpl(notification) {
        // 实现发送逻辑
    }

    async _startListeningImpl() {
        // 实现监听逻辑
    }

    async _handleCommandImpl(command, context) {
        // 实现命令处理
    }
}
```

### 3. 注册到系统

更新 `src/core/notifier.js`:

```javascript
// 加载新渠道
const DiscordChannel = require('../channels/chat/discord');
const discordConfig = this.config.getChannel('discord');
if (discordConfig && discordConfig.enabled) {
    const discord = new DiscordChannel(discordConfig.config || {});
    this.registerChannel('discord', discord);
}
```

### 4. 添加配置支持

更新 `config/channels.json`:

```json
{
  "discord": {
    "type": "chat",
    "enabled": false,
    "config": {
      "botToken": "",
      "channelId": "",
      "guildId": ""
    }
  }
}
```

更新 `.env.example`:

```env
# Discord 配置
DISCORD_BOT_TOKEN=your-discord-bot-token
DISCORD_CHANNEL_ID=123456789012345678
DISCORD_GUILD_ID=123456789012345678
```

### 5. 测试新渠道

```bash
# 创建测试文件
node -e "
const DiscordChannel = require('./src/channels/chat/discord');
const channel = new DiscordChannel({
    botToken: process.env.DISCORD_BOT_TOKEN,
    channelId: process.env.DISCORD_CHANNEL_ID
});
channel.test().then(console.log);
"
```

## 🧪 测试和调试

### 测试层次

1. **单元测试**: 测试单个组件
2. **集成测试**: 测试渠道集成 (`npm run telegram:test`)
3. **端到端测试**: 测试完整流程

### 调试技巧

```bash
# 详细日志
LOG_LEVEL=debug npm start

# 查看会话状态
ls -la src/data/sessions/

# 监控 tmux 会话
tmux list-sessions
tmux capture-pane -t <session> -p

# 检查配置
node -e "console.log(JSON.stringify(require('./config/channels.json'), null, 2))"
```

### 常见问题

1. **渠道连接失败**:
   - 检查 API 凭据
   - 验证网络连接
   - 查看错误日志

2. **命令注入失败**:
   - 确认 tmux 会话存在
   - 检查会话权限
   - 验证令牌有效性

3. **路由问题**:
   - 检查会话来源记录
   - 验证渠道注册状态
   - 确认路由逻辑

## 🚀 部署指南

### 生产环境配置

```bash
# 1. 克隆项目
git clone <repository>
cd Claude-Code-Remote

# 2. 安装生产依赖
npm ci --production

# 3. 配置环境变量
cp .env.example .env
# 编辑 .env 文件

# 4. 配置渠道
node src/config-manager.js

# 5. 启动服务
npm run daemon:start
```

### 系统服务配置

创建 systemd 服务文件 `/etc/systemd/system/claude-remote.service`:

```ini
[Unit]
Description=Claude Code Remote
After=network.target

[Service]
Type=simple
User=youruser
WorkingDirectory=/path/to/Claude-Code-Remote
ExecStart=/usr/bin/npm start
Restart=always
RestartSec=10
Environment=NODE_ENV=production

[Install]
WantedBy=multi-user.target
```

启用服务:

```bash
sudo systemctl enable claude-remote
sudo systemctl start claude-remote
sudo systemctl status claude-remote
```

### 监控和维护

```bash
# 查看服务状态
npm run multichannel:status

# 查看日志
journalctl -u claude-remote -f

# 重启服务
sudo systemctl restart claude-remote

# 更新配置
node src/config-manager.js
sudo systemctl reload claude-remote
```

## 📊 性能优化

### 1. 内存管理
- 定期清理过期会话
- 限制并发连接数
- 优化消息缓存

### 2. 网络优化
- 实现连接池
- 添加请求重试机制
- 使用批量操作

### 3. 监控指标
- 消息处理延迟
- 错误率统计
- 内存使用情况
- 连接状态监控

## 🔒 安全考虑

### 1. 认证和授权
- 白名单验证
- 令牌过期机制
- 会话隔离

### 2. 数据保护
- 敏感信息加密
- 日志脱敏
- 自动清理机制

### 3. 网络安全
- HTTPS/TLS 加密
- 请求频率限制
- 输入数据验证

---

## 🤝 贡献指南

1. Fork 项目
2. 创建功能分支: `git checkout -b feature/new-channel`
3. 提交更改: `git commit -am 'Add new channel'`
4. 推送分支: `git push origin feature/new-channel`
5. 创建 Pull Request

## 📄 许可证

MIT License - 详见 LICENSE 文件