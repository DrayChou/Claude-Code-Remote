# Telegram Integration Guide

## Overview

The Telegram integration was completely added to Claude-Code-Remote after commit `5159e53`, enabling users to receive notifications and send commands through Telegram bots. This integration provides a convenient way to interact with Claude Code remotely using the Telegram messaging platform.

## Key Features

### 🚀 Multi-Command Format Support
- **Traditional Format**: `/cmd TOKEN command`
- **Simple Format**: `TOKEN command`
- **Reply Format**: Reply directly to bot messages
- **Smart Format**: Just send commands (bot remembers recent tokens)

### 🎯 Flexible Chat Modes
- **Private Chat**: One-on-one conversations with the bot
- **Group Chat**: Commands in group settings
- **Dynamic Chat**: Auto-accept private messages from authorized users

### 📱 Rich Capabilities
- Real-time message polling with exponential backoff
- Smart message splitting for long responses
- Session management with token-based authentication
- Proxy support for restricted networks
- Comprehensive error handling and retry logic

## Architecture

### Core Components

#### 1. Telegram Channel (`src/channels/chat/telegram.js`)
- **Main Class**: `TelegramChannel` extends `NotificationChannel`
- **Size**: 1,573 lines of comprehensive implementation
- **Dependencies**: axios, dotenv, tmux-monitor, claude-headless-executor

#### 2. Integration Points
- **Notification System**: Sends completion notifications to Telegram
- **Command Relay**: Receives and executes commands from Telegram
- **Session Management**: Tracks active sessions with tokens
- **Authentication**: Token-based security with whitelisting

#### 3. Supporting Files
- **Test Suite**: `test/integration/telegram.test.js` - Comprehensive integration tests
- **Integration Tests**: `test/integration/test-telegram-integration.js` - Headless executor integration
- **Fix Tests**: `test/integration/test-telegram-fixes.js` - Auto-session creation tests

## Configuration

### Environment Variables

```bash
# Required
TELEGRAM_BOT_TOKEN=your_bot_token_here

# Optional - Chat Targets (at least one recommended)
TELEGRAM_CHAT_ID=your_private_chat_id
TELEGRAM_GROUP_ID=your_group_chat_id

# Optional - Security
TELEGRAM_WHITELIST=user_id1,user_id2,chat_id3

# Optional - Network
HTTP_PROXY=http://127.0.0.1:7890
```

### Channel Configuration (`config/channels.json`)

```json
{
  "telegram": {
    "type": "chat",
    "enabled": true,
    "config": {
      "botToken": "7772877613:AAG_pYKM_BHq3H1hwfPJ06gsWh7h4cytuIU",
      "chatId": "213800199",
      "groupId": "",
      "whitelist": [],
      "pollingInterval": 1000
    }
  }
}
```

## Setup Instructions

### 1. Create Telegram Bot
1. Message [@BotFather](https://t.me/BotFather) on Telegram
2. Use `/newbot` command
3. Follow prompts to set up bot name and username
4. Copy the bot token

### 2. Configure Environment
```bash
# Add to .env file
TELEGRAM_BOT_TOKEN=your_bot_token_here
TELEGRAM_CHAT_ID=your_chat_id  # Get from /start command
```

### 3. Test Configuration
```bash
# Test Telegram integration
node claude-remote.js test

# Run comprehensive test suite
node test/integration/telegram.test.js

# Test with headless executor
node test/integration/test-telegram-integration.js
```

## Usage

### Receiving Notifications
When Claude Code completes a task, you'll receive a Telegram message with:
- Task completion status
- Session token (8-character code)
- Command instructions
- Context from the conversation

### Sending Commands

#### Method 1: Traditional Format
```
/cmd ABC12345 analyze this code
```

#### Method 2: Simple Format
```
ABC12345 refactor the main module
```

#### Method 3: Reply Format
Simply reply to any bot message with your command.

#### Method 4: Smart Format
Just send your command directly - the bot remembers your recent token.

### Special Commands
- `/start` - Create new session and reset chat
- `/help` - Show detailed help information
- `/status` - Display bot configuration status

## Security Features

### Authentication
- **Token-based**: Each session has a unique 8-character token
- **Expiration**: Tokens expire after 24 hours
- **Whitelist**: Optional user/chat ID whitelisting
- **Session Isolation**: Each token controls only its session

### Authorization Logic
1. **Group Mode**: Only accepts commands from configured group
2. **Private Mode**: Only accepts commands from configured user
3. **Dynamic Mode**: Accepts private messages from authorized users
4. **Whitelist Mode**: Additional security layer for all modes

## Technical Implementation Details

### Core Architecture

#### 1. Cross-Platform Command Execution
The Telegram integration uses a sophisticated `ClaudeHeadlessExecutor` that handles different operating systems:

**Windows Implementation (PowerShell-based):**
- Uses `child_process.spawn()` to invoke `powershell.exe`
- Supports both `.ps1` script files and direct Claude CLI execution
- Handles UTF-8 encoding properly for international characters
- Implements real-time streaming with event-driven architecture

**Unix Implementation (Linux/macOS):**
- Uses traditional `child_process.exec()` and `spawn()`
- Supports both streaming and non-streaming modes
- Handles Claude CLI arguments directly

#### 2. PowerShell Execution Method (`claude-headless-executor.js:70-328`)

The Windows implementation uses a sophisticated PowerShell spawning approach:

```javascript
// PowerShell arguments construction
const psArgs = [
    '-NoProfile',
    '-ExecutionPolicy', 'Bypass',
    '-File', this.claudePath,  // .ps1 script file
    command,                   // user command as first argument
    '-p',                      // Claude CLI arguments
    '--output-format', 'stream-json',
    '--verbose'
];

// Spawn PowerShell process
const ps = spawn('powershell.exe', psArgs, {
    cwd: process.cwd(),
    env: { ...process.env },
    stdio: ['ignore', 'pipe', 'pipe'],
    encoding: 'utf8'
});
```

**Key Technical Features:**
- **Real-time Streaming**: Monitors `stdout` and `stderr` streams for live output
- **Error Detection**: Automatically detects authentication errors and API key issues
- **Timeout Handling**: Implements intelligent timeout with graceful degradation
- **JSON Stream Parsing**: Processes Claude's `stream-json` output format in real-time

#### 3. Stream Processing Architecture (`claude-headless-executor.js:333-414`)

The system processes Claude's streaming JSON output:

```javascript
// Process streaming JSON output
for (const line of lines) {
    try {
        const json = JSON.parse(line);
        
        // Extract assistant responses
        if (json.type === 'assistant' && json.message && json.message.content) {
            const textContent = json.message.content.find(c => c.type === 'text');
            if (textContent && textContent.text) {
                assistantResponse = textContent.text;
                break;
            }
        }
        
        // Extract result messages
        if (json.type === 'result' && json.subtype === 'success' && json.result) {
            if (!assistantResponse) {
                assistantResponse = json.result;
            }
        }
    } catch (e) {
        // Skip non-JSON lines
        continue;
    }
}
```

#### 4. Session Management and Token Generation

**Token Generation Algorithm:**
```javascript
function generateToken() {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    let token = '';
    for (let i = 0; i < 8; i++) {
        token += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return token;
}
```

**Session Structure:**
```javascript
{
    id: 'uuid-v4',
    token: 'ABC12345',
    type: 'telegram',
    created: '2025-08-02T10:30:00.000Z',
    expires: '2025-08-03T10:30:00.000Z',
    tmuxSession: 'project-session',
    project: 'project-name',
    chatId: 'telegram-chat-id',
    telegramConfig: {
        botToken: '***configured***',
        whitelist: ['user1', 'user2']
    }
}
```

#### 5. Message Processing Pipeline

**Incoming Message Processing:**
1. **Authorization Check**: Validates user/chat against whitelist and configuration
2. **Command Parsing**: Supports 4 different command formats
3. **Token Resolution**: Maps tokens to active sessions
4. **Command Execution**: Routes to appropriate executor
5. **Response Processing**: Handles streaming and final responses
6. **Message Delivery**: Splits long messages and sends to Telegram

**Outgoing Message Processing:**
1. **Session Creation**: Generates unique session and token
2. **Message Formatting**: Creates rich Telegram messages with Markdown
3. **Token Mapping**: Associates tokens with message IDs for reply handling
4. **Delivery**: Sends via Telegram Bot API with retry logic

#### 6. Error Handling and Retry Logic

**Network Error Handling:**
```javascript
_handleNetworkError(error) {
    if (error.code === 'ENOTFOUND' || error.code === 'ECONNREFUSED') {
        if (this.proxyConfig) {
            return `Network error: Cannot reach Telegram API via proxy`;
        } else {
            return `Network error: Cannot reach Telegram API`;
        }
    }
    // ... additional error handling
}
```

**Exponential Backoff:**
```javascript
// Implements exponential backoff for polling failures
const backoffTime = Math.min(
    this.pollingInterval * Math.pow(this.backoffMultiplier, this.consecutiveErrors),
    this.maxBackoffInterval
);
```

#### 7. Proxy Support Implementation

**Proxy Configuration:**
```javascript
_setupProxy() {
    const proxyUrl = process.env.HTTP_PROXY;
    if (proxyUrl) {
        const url = new URL(proxyUrl);
        return {
            host: url.hostname,
            port: parseInt(url.port) || (url.protocol === 'https:' ? 443 : 80),
            protocol: url.protocol.replace(':', ''),
            auth: url.username && url.password ? {
                username: decodeURIComponent(url.username),
                password: decodeURIComponent(url.password)
            } : undefined
        };
    }
    return null;
}
```

**SSL Configuration for Proxies:**
```javascript
// Relaxed SSL settings for proxy connections
config.httpsAgent = new https.Agent({
    rejectUnauthorized: false,
    secureProtocol: 'TLS_method',
    ciphers: 'ALL',
    honorCipherOrder: false,
    minVersion: 'TLSv1'
});
```

### PowerShell Script Integration

#### Calling .ps1 Scripts from Node.js

The system supports calling PowerShell scripts (.ps1) through several methods:

**Method 1: Direct Script Execution**
```javascript
const psArgs = [
    '-NoProfile',
    '-ExecutionPolicy', 'Bypass',
    '-File', 'C:\\path\\to\\claude.ps1',
    'user command here',
    '-p', '--output-format', 'stream-json'
];
const ps = spawn('powershell.exe', psArgs);
```

**Method 2: Command-Based Execution**
```javascript
const claudeCommand = `& 'claude' 'user command' -p --output-format stream-json`;
const psArgs = [
    '-NoProfile',
    '-ExecutionPolicy', 'Bypass',
    '-Command', `[Console]::InputEncoding = [Console]::OutputEncoding = New-Object System.Text.UTF8Encoding; ${claudeCommand}`
];
```

#### Stream Processing for PowerShell Output

The system implements sophisticated stream processing:

```javascript
ps.stdout.on('data', (data) => {
    const chunk = data.toString('utf8');
    stdout += chunk;
    
    // Real-time streaming callback
    if (options.onStream) {
        options.onStream({
            type: 'stdout',
            content: chunk,
            timestamp: new Date().toISOString()
        });
    }
});
```

#### Authentication Detection

Automatic detection of Claude authentication issues:

```javascript
if (chunk.includes('Invalid API key') || chunk.includes('Please run /login')) {
    hasError = true;
    resolve({
        success: false,
        error: 'authentication_required',
        message: 'Claude authentication required. Please run: claude --login'
    });
}
```

### Advanced Features

#### 1. Proxy Support
The integration supports HTTP/HTTPS proxies for restricted networks:
```bash
HTTP_PROXY=http://127.0.0.1:7890
```

**Features:**
- Automatic SSL certificate handling
- Proxy-specific error messages
- Network diagnostics
- Multiple proxy protocol support

#### 2. Smart Message Splitting
Intelligent text splitting for long messages:
- Prioritizes natural breakpoints (paragraphs, sentences)
- Handles multiple languages (English, Chinese punctuation)
- Preserves code formatting and structure
- Adds continuation indicators for multi-part messages

#### 3. Dynamic Session Management
- **Auto-creation**: Sessions created automatically for new commands
- **Token Memory**: Bot remembers recent tokens for convenience
- **Cleanup**: Automatic cleanup of expired sessions
- **Persistence**: Sessions stored in `src/data/sessions/`

### Message Handling
- **Smart Splitting**: Long messages are split intelligently at natural breakpoints
- **Markdown Support**: Rich text formatting in messages
- **Streaming Support**: Real-time command execution feedback
- **Error Recovery**: Automatic retry with exponential backoff

### Session Management
- **Auto-Creation**: Sessions created automatically for new commands
- **Token Memory**: Bot remembers recent tokens for convenience
- **Cleanup**: Automatic cleanup of expired sessions
- **Persistence**: Sessions stored in `src/data/sessions/`

## Testing

### Run All Tests
```bash
node test/integration/telegram.test.js
```

### Test Specific Components
```bash
# Test integration with headless executor
node test/integration/test-telegram-integration.js

# Test auto-session creation
node test/integration/test-telegram-fixes.js
```

### Test Coverage
The test suite covers:
- Bot API connectivity
- Configuration validation
- Message sending and receiving
- Command parsing (all 4 formats)
- Session management
- Error handling
- Network proxy support

## Troubleshooting

### Common Issues

#### Bot Not Responding
1. Check bot token is correct
2. Verify bot is running (`node claude-remote.js status`)
3. Test with `/start` command
4. Check logs for errors

#### Network Issues
```bash
# Test direct connection
curl "https://api.telegram.org/botYOUR_TOKEN/getMe"

# With proxy
HTTP_PROXY=http://127.0.0.1:7890 curl "https://api.telegram.org/botYOUR_TOKEN/getMe"
```

#### Token Not Working
1. Wait for new task notification (tokens expire in 24 hours)
2. Use `/start` to create new session
3. Check session files in `src/data/sessions/`

### Debug Commands
```bash
# Show bot status
node claude-remote.js status

# Check Telegram channel specifically
node claude-remote.js test

# View logs
tail -f src/data/daemon.log
```

## API Reference

### TelegramChannel Class

#### Constructor
```javascript
new TelegramChannel(config)
```

#### Key Methods
- `send(notification)` - Send notification to Telegram
- `startListening()` - Start message polling
- `stopListening()` - Stop message polling
- `test()` - Test bot connection and configuration
- `getStatus()` - Get current status information

#### Configuration Options
- `botToken`: Telegram bot token (required)
- `chatId`: Private chat ID (optional)
- `groupId`: Group chat ID (optional)
- `whitelist`: Array of authorized user/chat IDs (optional)
- `pollingInterval`: Polling interval in milliseconds (default: 1000)

## Integration Points

### With Claude Code
- Receives notifications via the notification system
- Sends commands through the command relay system
- Integrates with tmux session monitoring
- Uses the headless executor for command execution

### With Other Channels
- Works alongside email, desktop, and other notification channels
- Shares session management with other channels
- Uses common configuration system

## Future Enhancements

### Planned Features
- [ ] Webhook support for real-time updates
- [ ] File upload/download capabilities
- [ ] Inline keyboard buttons for common actions
- [ ] Multi-language support
- [ ] Advanced session management UI

### Contributing
To contribute to the Telegram integration:
1. Add tests for new features
2. Follow existing code patterns
3. Update documentation
4. Test with both private and group chats

## License

This integration is part of Claude-Code-Remote and follows the same license terms.