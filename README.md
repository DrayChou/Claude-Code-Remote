# Claude Code Remote - Telegram Bot

Control [Claude Code](https://claude.ai/code) remotely via Telegram. Send commands through a Telegram bot and receive streaming responses directly in your chat.

## Features

- **🤖 Telegram Bot Interface**: Send commands and receive responses via Telegram
- **📱 Streaming Responses**: Real-time message updates as Claude works
- **🔒 Secure Access**: User/Chat ID whitelisting for access control
- **🌍 Proxy Support**: HTTP proxy support for restricted regions
- **🎯 Smart Formatting**: Intelligent message formatting for better readability
- **📋 Multi-language Support**: Optimized for Chinese/English mixed content
- **🔄 Auto-retry**: Robust error handling and automatic retry logic
- **📊 Detailed Logging**: Comprehensive logging for debugging

## Quick Start

### 1. Install Dependencies

```bash
# Clone the repository
git clone https://github.com/JessyTsui/Claude-Code-Remote.git
cd Claude-Code-Remote

# Install Python dependencies
pip install -r requirements.txt
```

### 2. Configure Environment

```bash
# Copy the example configuration
cp .env.example .env

# Edit the configuration file
nano .env  # or use your preferred editor
```

Add your configuration:

```env
# Telegram Bot Token (from @BotFather)
TELEGRAM_BOT_TOKEN=your-telegram-bot-token

# Claude CLI configuration
CLAUDE_CLI_PATH=claude
CLAUDE_WORKING_DIR=/path/to/your/project

# User authorization (your user ID)
ALLOWED_USER_IDS=123456789

# Optional: Proxy configuration
HTTP_PROXY=http://127.0.0.1:7890
```

### 3. Set Up Telegram Bot

#### Create a Telegram Bot:
1. Message [@BotFather](https://t.me/BotFather) on Telegram
2. Send `/newbot` and follow the prompts
3. Save the **Bot Token** you receive

#### Get Your Chat ID:
1. Message [@userinfobot](https://t.me/userinfobot)
2. Send `/start` to get your **Chat ID**
3. Add it to `ALLOWED_USER_IDS` in your `.env` file

### 4. Run the Bot

```bash
# Start the bot
python telegram_bot.py

# Or with custom options
python telegram_bot.py --claude-working-dir "/path/to/project"
python telegram_bot.py --proxy "http://127.0.0.1:7890"
```

### 5. Start Using Claude

1. **Send a command** to your Telegram bot:
   ```
   What is 2+2?
   ```

2. **Watch the streaming response** as Claude thinks and responds

3. **Send follow-up commands** to continue the conversation

## Configuration Options

### Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `TELEGRAM_BOT_TOKEN` | Your Telegram bot token | Required |
| `CLAUDE_CLI_PATH` | Path to Claude CLI | `claude` |
| `CLAUDE_WORKING_DIR` | Directory where Claude works | Current directory |
| `ALLOWED_USER_IDS` | Comma-separated user IDs | None (allow all) |
| `ALLOWED_CHAT_IDS` | Comma-separated chat IDs | None (allow all) |
| `HTTP_PROXY` | HTTP proxy for Telegram API | None |
| `POLL_INTERVAL` | Polling interval in seconds | 2 |
| `CLAUDE_TIMEOUT` | Claude execution timeout | 60 |
| `LOG_LEVEL` | Logging level | `INFO` |

### Command Line Options

```bash
python telegram_bot.py [OPTIONS]

Options:
  --bot-token TOKEN           Telegram Bot Token
  --claude-cli-path PATH      Claude CLI path
  --claude-working-dir DIR    Claude working directory
  --proxy URL                 HTTP proxy URL
  --poll-interval SECONDS     Polling interval
  --claude-timeout SECONDS    Claude timeout
  --log-level LEVEL           Log level (DEBUG, INFO, WARNING, ERROR)
  --allowed-user-ids IDS      Allowed user IDs
  --allowed-chat-ids IDS      Allowed chat IDs
  --help                      Show help message
```

## Usage Examples

### Basic Commands

Send any command you would normally use with Claude:

```
What is 2+2?
```
```
Analyze the code in this directory
```
```
Create a Python script that scrapes websites
```

### Multi-line Commands

The bot supports complex, multi-line instructions:

```
I need you to:

1. Analyze the current codebase
2. Identify performance bottlenecks
3. Suggest optimizations
4. Implement the most critical ones

Please provide detailed explanations for each suggestion.
```

### Special Commands

- **`/id`** or **`id`**: Get your user and chat ID
- **`#id`**: Alternative ID command

## Advanced Features

### Streaming Responses

The bot provides real-time streaming responses:
- Initial "thinking" message appears immediately
- Response updates every 3 seconds as Claude works
- Final formatted response is delivered when complete
- Supports long responses with intelligent formatting

### Smart Message Formatting

The bot automatically formats responses for better readability:
- **List formatting**: Numbered and bulleted lists
- **Title recognition**: Headers and important text
- **Mixed language support**: Optimized for Chinese/English content
- **Code blocks**: Preserved formatting for technical content

### Security Features

- **User whitelisting**: Only authorized users can interact
- **Chat whitelisting**: Restrict to specific chats or groups
- **No data storage**: Messages are not stored after processing
- **Secure API communication**: All communication via HTTPS

### Proxy Support

For users in regions with restricted access:

```env
HTTP_PROXY=http://127.0.0.1:7890
```

Or via command line:
```bash
python telegram_bot.py --proxy "http://127.0.0.1:7890"
```

## Troubleshooting

### Common Issues

**Bot not responding?**
- Check `TELEGRAM_BOT_TOKEN` is correct
- Verify bot is running: `python telegram_bot.py --log-level DEBUG`
- Check your user ID is in `ALLOWED_USER_IDS`

**Claude commands failing?**
- Verify `CLAUDE_CLI_PATH` is correct
- Check `CLAUDE_WORKING_DIR` exists and is accessible
- Test Claude CLI manually: `claude --version`

**Network issues?**
- Configure proxy if needed
- Check internet connection
- Verify Telegram API is accessible

**Permission errors?**
- Check file permissions in working directory
- Verify Claude CLI has necessary permissions

### Debug Mode

Enable detailed logging:

```bash
python telegram_bot.py --log-level DEBUG
```

Or set in environment:
```env
LOG_LEVEL=DEBUG
```

## Architecture

### Components

- **TelegramBot**: Main bot class handling Telegram API
- **ClaudeResponse**: Data structure for Claude responses
- **Message Formatting**: Intelligent content formatting
- **Streaming Handler**: Real-time response updates
- **Authorization**: User and chat access control

### Flow

1. **Message Reception**: Bot polls Telegram for new messages
2. **Authorization**: Checks if user/chat is allowed
3. **Command Execution**: Sends command to Claude CLI
4. **Streaming Response**: Real-time updates via message editing
5. **Formatting**: Intelligent response formatting
6. **Delivery**: Final formatted response to user

## Requirements

- Python 3.7+
- Claude CLI installed and configured
- Telegram Bot Token
- Internet connection

## Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Test thoroughly
5. Submit a pull request

## License

MIT License - feel free to use and modify!

## Support

- 🐛 **Issues**: [GitHub Issues](https://github.com/JessyTsui/Claude-Code-Remote/issues)
- 💬 **Discussions**: Share your use cases and improvements
- 📧 **Contact**: Create an issue for support requests

---

**🚀 Make Claude Code truly remote with Telegram bot control!**

> 💡 **Tip**: This bot is perfect for remote development, long-running tasks, and mobile Claude access!