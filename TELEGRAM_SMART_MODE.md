# Telegram 智能模式说明

## 概述

新的 Telegram 集成现在支持智能模式选择，可以根据您的配置自动选择最适合的运行模式：

- **Webhook 模式**：如果您有公网可访问的 webhook URL
- **轮询模式**：如果您在受限网络环境中或无法配置 webhook

## 模式选择逻辑

系统会根据以下条件自动选择模式：

1. **Webhook 模式**：当设置了 `TELEGRAM_WEBHOOK_URL` 环境变量时
2. **轮询模式**：当未设置 `TELEGRAM_WEBHOOK_URL` 时（默认）

## 配置选项

### 基础配置（必需）
```bash
TELEGRAM_BOT_TOKEN=your_bot_token_here
```

### 聊天目标配置（至少一个）
```bash
# 私聊模式
TELEGRAM_CHAT_ID=your_chat_id

# 群聊模式  
TELEGRAM_GROUP_ID=your_group_id

# 或使用白名单（支持多个用户）
TELEGRAM_WHITELIST=user_id1,user_id2,user_id3
```

### Webhook 模式配置
```bash
# 启用 Webhook 模式
TELEGRAM_WEBHOOK_URL=https://your-domain.com/telegram
TELEGRAM_WEBHOOK_PORT=3001
```

### 轮询模式配置
```bash
# 轮询间隔（毫秒）
TELEGRAM_POLLING_INTERVAL=1000
```

### 代理配置（适用于轮询模式）
```bash
# HTTP 代理配置
HTTP_PROXY=http://127.0.0.1:7890
http_proxy=http://127.0.0.1:7890
```

## 启动脚本

### 智能模式（推荐）
```bash
# 自动选择最适合的模式
npm run telegram
# 或
npm run telegram:smart
# 或直接运行
node start-telegram-smart.js
```

### 强制使用特定模式
```bash
# Webhook 模式
npm run telegram:webhook

# 轮询模式
npm run telegram:polling
```

## 模式特点对比

### Webhook 模式
✅ **优点**：
- 实时性高，消息推送立即到达
- 服务器资源消耗低
- 适合稳定网络环境

❌ **缺点**：
- 需要公网可访问的 URL
- 在某些网络环境下可能被屏蔽

### 轮询模式
✅ **优点**：
- 不需要公网 IP 或 webhook URL
- 支持代理配置，适合受限网络
- 在防火墙后也能正常工作
- 内置错误处理和重试机制

❌ **缺点**：
- 有轻微延迟（取决于轮询间隔）
- 服务器资源消耗稍高

## 使用建议

1. **开发环境**：推荐使用轮询模式，无需配置 webhook
2. **生产环境**：如果有公网服务器，推荐使用 webhook 模式
3. **受限网络**：必须使用轮询模式 + 代理配置
4. **企业环境**：根据网络策略选择，轮询模式通常更可靠

## 环境变量示例

### 轮询模式示例
```bash
TELEGRAM_BOT_TOKEN=123456789:ABCdefGHIjklMNOpqrsTUVwxyz
TELEGRAM_CHAT_ID=987654321
HTTP_PROXY=http://127.0.0.1:7890
TELEGRAM_POLLING_INTERVAL=2000
```

### Webhook 模式示例
```bash
TELEGRAM_BOT_TOKEN=123456789:ABCdefGHIjklMNOpqrsTUVwxyz
TELEGRAM_GROUP_ID=-1001234567890
TELEGRAM_WEBHOOK_URL=https://your-domain.com/telegram
TELEGRAM_WEBHOOK_PORT=3001
```

### 动态私聊示例
```bash
TELEGRAM_BOT_TOKEN=123456789:ABCdefGHIjklMNOpqrsTUVwxyz
TELEGRAM_WHITELIST=987654321,123456789
```

## 命令格式

系统支持多种命令格式：

1. **传统格式**：`/cmd TOKEN command`
2. **简化格式**：`TOKEN command`
3. **回复格式**：直接回复 bot 消息
4. **智能格式**：仅发送命令（bot 会记住最近的 token）

## 故障排除

### 轮询模式问题
- 检查代理配置是否正确
- 确认网络可以访问 Telegram API
- 查看日志中的错误信息

### Webhook 模式问题
- 确认 webhook URL 可以公网访问
- 检查服务器防火墙设置
- 验证 SSL 证书配置

### 通用问题
- 确认 Bot Token 有效
- 检查聊天 ID 或群组 ID 是否正确
- 验证用户是否在白名单中

## 迁移指南

如果您之前使用的是 webhook 模式：

1. 备份现有配置
2. 选择适合的新模式
3. 更新环境变量
4. 使用新的启动脚本

系统会自动向后兼容，您的现有配置仍然有效。