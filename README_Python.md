# Python Telegram Bot for Claude Remote Control

这是一个简单的Python实现，用于通过Telegram机器人远程控制Claude。

## 功能特性

- 🤖 **简单架构**: 纯Python实现，易于理解和维护
- 📱 **Telegram轮询**: 定时获取Telegram消息更新
- 🔄 **Claude集成**: 调用Claude PS1脚本处理命令
- ✂️ **智能分片**: 自动分割长消息，优先在自然断点分割
- 🔒 **安全控制**: 支持用户和聊天白名单
- 📝 **详细日志**: 完整的执行过程日志

## 快速开始

### 1. 安装依赖

```bash
pip install -r requirements.txt
```

### 2. 配置机器人

```bash
# 复制配置模板
cp python.env.example .env

# 编辑配置文件
notepad .env  # Windows
# vim .env    # Linux/Mac
```

### 3. 获取Telegram Bot Token

1. 与 [@BotFather](https://t.me/botfather) 对话
2. 发送 `/newbot` 创建新机器人
3. 按提示设置机器人名称和用户名
4. 获取Bot Token并填入配置文件

### 4. 获取聊天ID（可选，用于安全限制）

1. 个人聊天ID: 与 [@userinfobot](https://t.me/userinfobot) 对话
2. 群组ID: 将bot加入群组，发送消息，访问 `https://api.telegram.org/bot<YOUR_TOKEN>/getUpdates`

### 5. 配置Claude CLI路径

确保您的Claude CLI路径正确，例如：
```bash
# Windows PowerShell脚本
CLAUDE_CLI_PATH=C:\Users\YourUsername\scoop\shims\claude.ps1

# 或直接可执行文件
CLAUDE_CLI_PATH=claude
```

### 6. 运行机器人

```bash
# 使用启动脚本（推荐）
python start_bot.py

# 或直接运行
python telegram_bot.py
```

## 配置选项

### 必需配置

| 配置项 | 说明 | 示例 |
|--------|------|------|
| `TELEGRAM_BOT_TOKEN` | Telegram Bot Token | `123456:ABC-DEF...` |
| `CLAUDE_CLI_PATH` | Claude CLI路径 | `C:\Users\...\claude.ps1` |

### 可选配置

| 配置项 | 默认值 | 说明 |
|--------|--------|------|
| `POLL_INTERVAL` | `2` | 轮询间隔（秒） |
| `CLAUDE_TIMEOUT` | `60` | Claude执行超时（秒） |
| `LOG_LEVEL` | `INFO` | 日志级别 |
| `ALLOWED_USER_IDS` | `空` | 允许的用户ID列表 |
| `ALLOWED_CHAT_IDS` | `空` | 允许的聊天ID列表 |

## 使用方法

1. 启动机器人后，向机器人发送任意消息
2. 机器人会调用Claude处理您的消息
3. Claude的回复会自动发送回Telegram
4. 长消息会自动分片发送

## 消息分片机制

当Claude回复超过4096字符时，机器人会智能分割消息：

1. **优先级分割点**：
   - 双换行（段落分隔）
   - 单换行
   - 句号+空格
   - 逗号+空格
   - 空格

2. **分片标记**：每个分片会显示 `[1/3]` 这样的标记

## 测试

运行测试套件检查功能：

```bash
python test_python_bot.py
```

测试内容包括：
- 消息分片功能
- Claude响应解析
- Telegram消息处理
- API连接测试

## 日志

机器人会输出详细的运行日志：

```
2024-01-01 12:00:00 - TelegramBot - INFO - 初始化Telegram机器人，Claude路径: C:\...\claude.ps1
2024-01-01 12:00:01 - TelegramBot - INFO - Telegram机器人启动
2024-01-01 12:00:02 - TelegramBot - INFO - 收到 1 条更新
2024-01-01 12:00:02 - TelegramBot - INFO - 处理来自 @username 的消息: 你好...
2024-01-01 12:00:03 - TelegramBot - INFO - 调用Claude命令: 你好...
2024-01-01 12:00:05 - TelegramBot - INFO - Claude执行完成，耗时: 2.34秒
2024-01-01 12:00:05 - TelegramBot - INFO - 准备发送回复 (123 字符)
2024-01-01 12:00:06 - TelegramBot - INFO - 消息发送成功到聊天 123456789
```

## 故障排除

### 常见问题

1. **Bot Token无效**
   - 检查token格式是否正确
   - 确认bot未被删除

2. **Claude路径错误**
   - 检查路径是否存在
   - 确认有执行权限

3. **消息发送失败**
   - 检查网络连接
   - 确认bot有发送消息权限

4. **Claude执行超时**
   - 增加 `CLAUDE_TIMEOUT` 值
   - 检查Claude CLI是否正常工作

### 调试模式

设置日志级别为DEBUG获得更详细信息：

```bash
LOG_LEVEL=DEBUG python run_telegram_bot.py
```

## 架构设计

```
用户消息 -> Telegram API -> Python Bot -> Claude PS1 -> Claude AI
                                      |
回复消息 <- Telegram API <- 分片处理 <- 响应提取 <- Claude输出
```

## 与Node.js版本对比

| 特性 | Python版本 | Node.js版本 |
|------|------------|-------------|
| 复杂度 | ⭐⭐ | ⭐⭐⭐⭐⭐ |
| 功能 | 核心功能 | 完整功能 |
| 依赖 | 最小 | 较多 |
| 维护性 | 高 | 中等 |
| 邮件支持 | ❌ | ✅ |
| Session管理 | ❌ | ✅ |
| 多渠道通知 | ❌ | ✅ |

Python版本专注于核心的Telegram-Claude交互，提供简单可靠的远程控制体验。

## 许可证

MIT License