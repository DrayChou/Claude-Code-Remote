# Claude Code Remote

Control [Claude Code](https://claude.ai/code) remotely via email. Start tasks locally, receive notifications when Claude completes them, and send new commands by simply replying to emails.

<div align="center">
  
  ### 🎥 Watch Demo Video
  
  <a href="https://youtu.be/_yrNlDYOJhw">
    <img src="./assets/CCRemote_demo.png" alt="Claude Code Remote Demo" width="100%">
    <br>
    <img src="https://img.shields.io/badge/▶-Watch%20on%20YouTube-red?style=for-the-badge&logo=youtube" alt="Watch on YouTube">
  </a>
  
</div>

> 🐦 Follow [@Jiaxi_Cui](https://x.com/Jiaxi_Cui) for updates and AI development insights

## ✨ Features

- **📧 Email Notifications**: Get notified when Claude completes tasks ![](./assets/email_demo.png)
- **🔄 Email Control**: Reply to emails to send new commands to Claude
- **📱 Telegram Integration**: Receive notifications and send commands via Telegram bot
- **🤖 Smart Routing**: Intelligent channel selection based on message origin
- **🎯 Multi-Channel Support**: Simultaneous monitoring of multiple communication channels
- **📱 Remote Access**: Control Claude from anywhere with email, Telegram, or other channels
- **🔒 Secure**: Whitelist-based sender verification for all channels
- **📋 Multi-line Support**: Send complex commands with formatting
- **🚀 Extensible Architecture**: Easy to add new communication channels (Discord, LINE, etc.)


## 📅 Changelog

### January 2025
- **2025-08-01**: Implement terminal-style UI for email notifications ([#8](https://github.com/JessyTsui/Claude-Code-Remote/pull/8) by [@vaclisinc](https://github.com/vaclisinc))
- **2025-08-01**: Fix working directory issue - enable claude-remote to run from any directory ([#7](https://github.com/JessyTsui/Claude-Code-Remote/pull/7) by [@vaclisinc](https://github.com/vaclisinc))
- **2025-07-31**: Fix self-reply loop issue when using same email for send/receive ([#4](https://github.com/JessyTsui/Claude-Code-Remote/pull/4) by [@vaclisinc](https://github.com/vaclisinc))

### July 2025
- **2025-07-28**: Remove hardcoded values and implement environment-based configuration ([#2](https://github.com/JessyTsui/Claude-Code-Remote/pull/2) by [@kevinsslin](https://github.com/kevinsslin))

## 📋 TODO List

### Notification Channels
- [x] **Telegram**: Bot integration for messaging platforms
- [ ] **Discord**: Bot integration for messaging platforms  
- [ ] **Slack Workflow**: Native Slack app with slash commands

### Developer Tools
- [ ] **AI Tools**: Support for Gemini CLI, Cursor, and other AI tools
- [ ] **Git Automation**: Auto-commit, PR creation, branch management

### Usage Analytics
- [ ] **Cost Tracking**: Token usage and estimated costs
- [ ] **Performance Metrics**: Execution time and resource usage
- [ ] **Scheduled Reports**: Daily/weekly usage summaries via email

### Native Apps
- [ ] **Mobile Apps**: iOS and Android applications
- [ ] **Desktop Apps**: macOS and Windows native clients


## 🚀 Setup Guide

Follow these steps to get Claude Code Remote running:

### Step 1: Clone and Install Dependencies

```bash
git clone https://github.com/JessyTsui/Claude-Code-Remote.git
cd Claude-Code-Remote
npm install
```

### Step 2: Configure Notification Settings

You can use Email, Telegram, or both for notifications:

#### Option A: Quick Configuration Manager

```bash
# Run the interactive configuration manager
node src/config-manager.js

# Choose your notification channels:
# 1. Configure Email
# 2. Configure Telegram
# 3. Configure other channels
```

#### Option B: Manual Configuration

```bash
# Copy the example configuration
cp .env.example .env

# Edit environment variables
nano .env  # or use vim, code, etc.
```

### Step 2b: Telegram Bot Setup (If Using Telegram)

#### Create Telegram Bot:
1. Message [@BotFather](https://t.me/BotFather) on Telegram
2. Send `/newbot` and follow prompts
3. Save the **Bot Token** you receive

#### Get Your Chat ID:
1. Message [@userinfobot](https://t.me/userinfobot)
2. Send `/start` to get your **Chat ID**
3. Add both to your `.env` file

#### Telegram Support Modes:
- **Private Chat**: Configure `TELEGRAM_CHAT_ID` for specific user
- **Group Chat**: Configure `TELEGRAM_GROUP_ID` for specific group  
- **Dynamic Mode**: Just `TELEGRAM_BOT_TOKEN` - accepts any authorized private chat
- **Whitelist Mode**: Add `TELEGRAM_WHITELIST` for user restrictions

Edit the `.env` file with your credentials:

```env
# ===== Email Configuration =====
SMTP_USER=your-email@gmail.com
SMTP_PASS=your-app-password    # Gmail: use App Password, not regular password
IMAP_USER=your-email@gmail.com  
IMAP_PASS=your-app-password
EMAIL_TO=your-notification-email@gmail.com
ALLOWED_SENDERS=your-notification-email@gmail.com

# ===== Telegram Configuration =====
TELEGRAM_BOT_TOKEN=your-telegram-bot-token
TELEGRAM_CHAT_ID=your-chat-id           # For private chat
TELEGRAM_GROUP_ID=your-group-id         # For group chat (optional)
TELEGRAM_WHITELIST=user1,user2,user3    # Authorized users (optional)

# ===== System Configuration =====
SESSION_MAP_PATH=/your/absolute/path/to/Claude-Code-Remote/src/data/session-map.json
```

📌 **Configuration Tips**:
- **Email**: Gmail users need [App Passwords](https://myaccount.google.com/security)
- **Telegram**: Create bot with [@BotFather](https://t.me/BotFather), get Chat ID from [@userinfobot](https://t.me/userinfobot)
- **Flexible Setup**: You can configure just email, just Telegram, or both!

### Step 3: Set Up Claude Code Hooks

Open Claude's settings file:

```bash
# Create the directory if it doesn't exist
mkdir -p ~/.claude

# Edit settings.json
nano ~/.claude/settings.json
```

Add this configuration (replace `/your/absolute/path/` with your actual path):

```json
{
  "hooks": {
    "Stop": [{
      "matcher": "*",
      "hooks": [{
        "type": "command",
        "command": "node /your/absolute/path/to/Claude-Code-Remote/claude-remote.js notify --type completed",
        "timeout": 5
      }]
    }],
    "SubagentStop": [{
      "matcher": "*",
      "hooks": [{
        "type": "command",
        "command": "node /your/absolute/path/to/Claude-Code-Remote/claude-remote.js notify --type waiting",
        "timeout": 5
      }]
    }]
  }
}
```

> **Note**: Subagent notifications are disabled by default. To enable them, set `enableSubagentNotifications: true` in your config. See [Subagent Notifications Guide](./docs/SUBAGENT_NOTIFICATIONS.md) for details.

### Step 4: Test Your Setup

```bash
# Test email configuration
node claude-remote.js test
```

You should receive a test email. If not, check your email settings.

### Step 5: Start Claude Code Remote

**Recommended: Multi-Channel Service (handles all configured channels)**
```bash
npm start
```

You should see:
```
🚀 Claude Code Remote - Multi-Channel Service
📧 Email: Ready
📱 Telegram: Ready  
🎯 Monitoring all channels...
```

**Alternative Options:**
```bash
npm run relay:pty        # Email only
npm run telegram:polling # Telegram only (separate terminal)
```

**Terminal 2 - Start Claude in tmux:**
```bash
# Create a new tmux session
tmux new-session -s my-project

# Inside tmux, start Claude
claude
```

### Step 6: You're Ready!

1. Use Claude normally in the tmux session
2. When Claude completes a task, you'll receive an email
3. Reply to the email with new commands
4. Your commands will execute automatically in Claude

### Verify Everything Works

In Claude, type:
```
What is 2+2?
```

Wait for Claude to respond, then check your email. You should receive a notification!

## 📖 How to Use

### Email Notifications
When Claude completes a task, you'll receive an email notification:

```
Subject: Claude Code Remote Task Complete [#ABC123]

Claude completed: "analyze the code structure"

[Claude's full response here...]

Reply to this email to send new commands.
```

### Sending Commands

#### Via Email Reply:
1. **Direct Reply**: Simply reply to the notification email
2. **Write Command**: Type your command in the email body:
   ```
   Please refactor the main function and add error handling
   ```
3. **Send**: Your command will automatically execute in Claude!

#### Via Telegram:
1. **Receive Notification**: You'll get a message with a session token
2. **Send Command**: Reply with the format:
   ```
   /cmd ABC12345 your command here
   ```
   Or use the short format:
   ```
   ABC12345 your command here
   ```
3. **Execute**: Your command runs automatically in Claude!

#### Advanced Features:

**Multi-line Commands** (both Email and Telegram):
```
First analyze the current code structure.
Then create a comprehensive test suite.
Finally, update the documentation.
```

**Complex Instructions**:
```
Refactor the authentication module with these requirements:
- Use JWT tokens instead of sessions
- Add rate limiting  
- Implement refresh token logic
- Update all related tests
```

### Command Workflow

1. **Receive Notification** → Get notified via your configured channels when Claude completes a task
2. **Send Command** → Reply with your next instruction using email reply or Telegram commands
3. **Smart Routing** → The system automatically routes your command to the correct Claude session
4. **Get Results** → Receive notifications in the same channel where you sent the command

### Supported Platforms

**Email Clients:**
- ✅ Gmail (Web/Mobile)
- ✅ Apple Mail
- ✅ Outlook
- ✅ Any SMTP-compatible client

**Telegram Features:**
- ✅ Private chat with bot
- ✅ Group chat support
- ✅ Dynamic chat discovery
- ✅ Built-in help commands (`/help`, `/status`)
- ✅ Token-based security

## 💡 Common Use Cases

- **Remote Development**: Start coding at the office, continue from home via email or Telegram
- **Long Tasks**: Let Claude work while you're in meetings, get notified on your phone
- **Team Collaboration**: Share Claude sessions in Telegram groups or forward notification emails
- **Mobile Workflow**: Control Claude from your phone using Telegram while away from computer
- **Multi-Device**: Get notifications on all your devices, respond from any of them

## 🔧 Useful Commands

```bash
# Test all configured channels
npm test

# Check system status  
node claude-remote.js status
npm run multichannel:status

# Test specific channels
node claude-remote.js test        # Test all
npm run telegram:test            # Test Telegram only

# View tmux sessions
tmux list-sessions
tmux attach -t my-project

# Stop monitoring
# Press Ctrl+C in the terminal running npm start
```

## 🔍 Troubleshooting

**Not receiving notifications?**
- Run `npm test` to test all channels
- **Email**: Check spam folder, verify SMTP settings, use Gmail App Password
- **Telegram**: Verify bot token and chat ID, check bot permissions

**Commands not executing?**
- Ensure tmux session is running: `tmux list-sessions`
- **Email**: Check sender matches `ALLOWED_SENDERS` in `.env`
- **Telegram**: Verify you're using correct token format, check whitelist settings
- Verify Claude is running inside tmux

**Channel-specific issues?**
- Check configuration: `npm run multichannel:status`
- View detailed logs: `LOG_LEVEL=debug npm start`

**Need help?**
- Check [Issues](https://github.com/JessyTsui/Claude-Code-Remote/issues)  
- Read [Development Guide](./docs/DEVELOPMENT.md) for advanced usage
- Follow [@Jiaxi_Cui](https://x.com/Jiaxi_Cui) for updates

## 🛡️ Security

- ✅ **Sender Whitelist**: Only authorized emails can send commands
- ✅ **Session Isolation**: Each token controls only its specific session
- ✅ **Auto Expiration**: Sessions timeout automatically

## 🤝 Contributing

Found a bug or have a feature request? 

- 🐛 **Issues**: [GitHub Issues](https://github.com/JessyTsui/Claude-Code-Remote/issues)
- 🐦 **Updates**: Follow [@Jiaxi_Cui](https://x.com/Jiaxi_Cui) on Twitter
- 💬 **Discussions**: Share your use cases and improvements

## 📄 License

MIT License - Feel free to use and modify!

---

**🚀 Make Claude Code truly remote and accessible from anywhere!**

## ⭐ Star History

[![Star History Chart](https://api.star-history.com/svg?repos=JessyTsui/Claude-Code-Remote&type=Date)](https://star-history.com/#JessyTsui/Claude-Code-Remote&Date)

⭐ **Star this repo** if it helps you code more efficiently!

> 💡 **Tip**: Share your remote coding setup on Twitter and tag [@Jiaxi_Cui](https://x.com/Jiaxi_Cui) - we love seeing how developers use Claude Code Remote!