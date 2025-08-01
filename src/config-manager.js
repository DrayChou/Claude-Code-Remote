const fs = require('fs');
const path = require('path');
const readline = require('readline');
const Logger = require('./core/logger');
const ConfigManager = require('./core/config');

// 加载环境变量
const envPath = path.join(__dirname, '../.env');
if (fs.existsSync(envPath)) {
  require('dotenv').config({ path: envPath });
}

const logger = new Logger('ConfigManager');

class InteractiveConfigManager {
  constructor() {
    this.configPath = path.join(__dirname, '../config/channels.json');
    this.configManager = new ConfigManager();
    this.rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout
    });
  }

  async loadConfig() {
    try {
      // 首先尝试加载现有配置
      if (fs.existsSync(this.configPath)) {
        const data = fs.readFileSync(this.configPath, 'utf8');
        return JSON.parse(data);
      } else {
        // 如果没有配置文件，使用默认配置（包含环境变量）
        logger.info('No existing channels.json found, using default configuration with environment variables');
        return this.configManager.getDefaultChannelsConfig();
      }
    } catch (error) {
      logger.warn('Failed to load existing config, using defaults:', error.message);
      return this.configManager.getDefaultChannelsConfig();
    }
  }

  async saveConfig(config) {
    try {
      fs.writeFileSync(this.configPath, JSON.stringify(config, null, 2));
      logger.info('Configuration saved successfully');
    } catch (error) {
      logger.error('Failed to save config:', error);
      throw error;
    }
  }

  async question(prompt) {
    return new Promise((resolve) => {
      this.rl.question(prompt, resolve);
    });
  }

  async configureEmail() {
    console.log('\n📧 Email Configuration Setup\n');
    
    const config = await this.loadConfig();
    
    // 确保 email 配置结构存在，优先使用环境变量
    if (!config.email) {
      config.email = { type: 'email', enabled: false, config: {} };
    }
    if (!config.email.config) {
      config.email.config = {};
    }
    if (!config.email.config.smtp) {
      config.email.config.smtp = { 
        host: process.env.SMTP_HOST || 'smtp.gmail.com', 
        port: parseInt(process.env.SMTP_PORT) || 587, 
        auth: { 
          user: process.env.SMTP_USER || '', 
          pass: process.env.SMTP_PASS || '' 
        } 
      };
    }
    if (!config.email.config.smtp.auth) {
      config.email.config.smtp.auth = { 
        user: process.env.SMTP_USER || '', 
        pass: process.env.SMTP_PASS || '' 
      };
    }
    if (!config.email.config.imap) {
      config.email.config.imap = { 
        host: process.env.IMAP_HOST || 'imap.gmail.com', 
        port: parseInt(process.env.IMAP_PORT) || 993, 
        auth: { 
          user: process.env.IMAP_USER || process.env.SMTP_USER || '', 
          pass: process.env.IMAP_PASS || process.env.SMTP_PASS || '' 
        } 
      };
    }
    if (!config.email.config.imap.auth) {
      config.email.config.imap.auth = { 
        user: process.env.IMAP_USER || process.env.SMTP_USER || '', 
        pass: process.env.IMAP_PASS || process.env.SMTP_PASS || '' 
      };
    }
    if (!config.email.config.from) {
      config.email.config.from = process.env.EMAIL_FROM || `Claude-Code-Remote <${process.env.SMTP_USER}>`;
    }
    if (!config.email.config.to) {
      config.email.config.to = process.env.EMAIL_TO || '';
    }
    
    console.log('Please enter your email configuration:');
    console.log('(Press Enter to keep current value)\n');
    
    // 提供环境变量优先的提示
    if (process.env.SMTP_USER || process.env.IMAP_USER) {
      console.log('📌 Environment variables detected:');
      if (process.env.SMTP_USER) console.log(`   SMTP_USER: ${process.env.SMTP_USER}`);
      if (process.env.IMAP_USER) console.log(`   IMAP_USER: ${process.env.IMAP_USER}`);
      console.log('   You can skip configuration to use environment variables.\n');
    }

    // SMTP Configuration
    console.log('--- SMTP Settings (for sending emails) ---');
    const smtpHost = await this.question(`SMTP Host [${config.email.config.smtp.host || 'smtp.gmail.com'}]: `);
    config.email.config.smtp.host = smtpHost || config.email.config.smtp.host || 'smtp.gmail.com';

    const smtpPort = await this.question(`SMTP Port [${config.email.config.smtp.port || 587}]: `);
    config.email.config.smtp.port = parseInt(smtpPort) || config.email.config.smtp.port || 587;

    const smtpUser = await this.question(`Email Address [${config.email.config.smtp.auth.user || ''}]: `);
    config.email.config.smtp.auth.user = smtpUser || config.email.config.smtp.auth.user;

    const smtpPass = await this.question(`App Password [${config.email.config.smtp.auth.pass ? '***' : ''}]: `);
    if (smtpPass) {
      config.email.config.smtp.auth.pass = smtpPass;
    }

    // IMAP Configuration
    console.log('\n--- IMAP Settings (for receiving emails) ---');
    const imapHost = await this.question(`IMAP Host [${config.email.config.imap.host || 'imap.gmail.com'}]: `);
    config.email.config.imap.host = imapHost || config.email.config.imap.host || 'imap.gmail.com';

    const imapPort = await this.question(`IMAP Port [${config.email.config.imap.port || 993}]: `);
    config.email.config.imap.port = parseInt(imapPort) || config.email.config.imap.port || 993;

    // Use same credentials as SMTP by default
    config.email.config.imap.auth.user = config.email.config.smtp.auth.user;
    config.email.config.imap.auth.pass = config.email.config.smtp.auth.pass;

    // Email addresses
    console.log('\n--- Email Addresses ---');
    const fromEmail = await this.question(`From Address [${config.email.config.from || `Claude-Code-Remote <${config.email.config.smtp.auth.user}>`}]: `);
    config.email.config.from = fromEmail || config.email.config.from || `Claude-Code-Remote <${config.email.config.smtp.auth.user}>`;

    const toEmail = await this.question(`To Address [${config.email.config.to || config.email.config.smtp.auth.user}]: `);
    config.email.config.to = toEmail || config.email.config.to || config.email.config.smtp.auth.user;

    // Enable email
    const enable = await this.question('\nEnable email notifications? (y/n) [y]: ');
    config.email.enabled = enable.toLowerCase() !== 'n';

    await this.saveConfig(config);
    console.log('\n✅ Email configuration completed!');
    
    if (config.email.enabled) {
      console.log('\n📌 Important: Make sure to use an App Password (not your regular password)');
      console.log('   Gmail: https://support.google.com/accounts/answer/185833');
      console.log('   Outlook: https://support.microsoft.com/en-us/account-billing/using-app-passwords-with-apps-that-don-t-support-two-step-verification-5896ed9b-4263-e681-128a-a6f2979a7944');
      
      console.log('\n💡 Alternative: You can also use environment variables in .env file:');
      console.log('   SMTP_USER=your-email@gmail.com');
      console.log('   SMTP_PASS=your-app-password');
      console.log('   IMAP_USER=your-email@gmail.com');
      console.log('   IMAP_PASS=your-app-password');
    }
  }

  async configureTelegram() {
    console.log('\n📱 Telegram Configuration Setup\n');
    
    const config = await this.loadConfig();
    
    // 确保 telegram 配置结构存在，优先使用环境变量
    if (!config.telegram) {
      config.telegram = { type: 'chat', enabled: false, config: {} };
    }
    if (!config.telegram.config) {
      config.telegram.config = {
        botToken: process.env.TELEGRAM_BOT_TOKEN || '',
        chatId: process.env.TELEGRAM_CHAT_ID || '',
        groupId: process.env.TELEGRAM_GROUP_ID || '',
        whitelist: process.env.TELEGRAM_WHITELIST ? process.env.TELEGRAM_WHITELIST.split(',') : [],
        pollingInterval: parseInt(process.env.TELEGRAM_POLLING_INTERVAL) || 1000
      };
    }
    
    console.log('Please enter your Telegram bot configuration:');
    console.log('(Press Enter to keep current value)\n');
    
    // 提供环境变量优先的提示
    if (process.env.TELEGRAM_BOT_TOKEN) {
      console.log('📌 Environment variables detected:');
      console.log(`   TELEGRAM_BOT_TOKEN: ${process.env.TELEGRAM_BOT_TOKEN.substring(0, 10)}...`);
      if (process.env.TELEGRAM_CHAT_ID) console.log(`   TELEGRAM_CHAT_ID: ${process.env.TELEGRAM_CHAT_ID}`);
      if (process.env.TELEGRAM_GROUP_ID) console.log(`   TELEGRAM_GROUP_ID: ${process.env.TELEGRAM_GROUP_ID}`);
      console.log('   You can skip configuration to use environment variables.\n');
    }

    console.log('--- Bot Settings ---');
    const botToken = await this.question(`Bot Token [${config.telegram.config.botToken ? '***' : ''}]: `);
    if (botToken) {
      config.telegram.config.botToken = botToken;
    }

    const chatId = await this.question(`Chat ID [${config.telegram.config.chatId || ''}]: `);
    if (chatId) {
      config.telegram.config.chatId = chatId;
    }

    const groupId = await this.question(`Group ID (optional) [${config.telegram.config.groupId || ''}]: `);
    if (groupId) {
      config.telegram.config.groupId = groupId;
    }

    // 配置模式说明
    console.log('\n--- Configuration Modes ---');
    console.log('🔹 Private Chat: Configure Chat ID for specific user');
    console.log('🔹 Group Chat: Configure Group ID for specific group');
    console.log('🔹 Dynamic Mode: Just Bot Token - accepts any authorized private chat');

    // Enable Telegram
    const enable = await this.question('\nEnable Telegram notifications? (y/n) [y]: ');
    config.telegram.enabled = enable.toLowerCase() !== 'n';

    await this.saveConfig(config);
    console.log('\n✅ Telegram configuration completed!');
    
    if (config.telegram.enabled) {
      console.log('\n📌 How to set up Telegram bot:');
      console.log('1. Create a bot using @BotFather on Telegram');
      console.log('2. Get the bot token from BotFather');
      console.log('3. Get your chat ID by sending /start to @userinfobot');
      console.log('4. Add your bot to the chat where you want to receive notifications');
      console.log('5. Test the configuration using: npm test');
      
      console.log('\n💡 Configuration Tips:');
      console.log('• Private chat: Use your personal Chat ID');
      console.log('• Group chat: Use the Group ID instead');
      console.log('• Dynamic mode: Only Bot Token needed, accepts any private chat');
    }
  }

  async showCurrentConfig() {
    const config = await this.loadConfig();
    console.log('\n📋 Current Configuration:\n');
    
    for (const [channel, settings] of Object.entries(config)) {
      console.log(`${channel}:`);
      console.log(`  Enabled: ${settings.enabled ? '✅' : '❌'}`);
      
      // 检查是否有配置信息（包括环境变量）
      if (channel === 'email') {
        const hasConfig = settings.config && settings.config.smtp && settings.config.smtp.auth && settings.config.smtp.auth.user;
        const hasEnv = process.env.SMTP_USER || process.env.IMAP_USER;
        
        if (hasConfig) {
          console.log(`  📧 File Configuration:`);
          console.log(`    Email: ${settings.config.smtp.auth.user}`);
          console.log(`    SMTP: ${settings.config.smtp.host}:${settings.config.smtp.port}`);
          console.log(`    IMAP: ${settings.config.imap.host}:${settings.config.imap.port}`);
        } else if (hasEnv) {
          console.log(`  📧 Environment Variables:`);
          if (process.env.SMTP_USER) console.log(`    SMTP User: ${process.env.SMTP_USER}`);
          if (process.env.IMAP_USER) console.log(`    IMAP User: ${process.env.IMAP_USER}`);
          console.log(`    SMTP Host: ${process.env.SMTP_HOST || 'smtp.gmail.com'}`);
          console.log(`    IMAP Host: ${process.env.IMAP_HOST || 'imap.gmail.com'}`);
        } else {
          console.log(`  ⚠️  No configuration found`);
        }
      } else if (channel === 'telegram') {
        const hasConfig = settings.config && settings.config.botToken;
        const hasEnv = process.env.TELEGRAM_BOT_TOKEN;
        
        if (hasConfig) {
          console.log(`  📱 File Configuration:`);
          console.log(`    Bot Token: ${settings.config.botToken.substring(0, 10)}...`);
          console.log(`    Chat ID: ${settings.config.chatId || 'not set'}`);
          console.log(`    Group ID: ${settings.config.groupId || 'not set'}`);
        } else if (hasEnv) {
          console.log(`  📱 Environment Variables:`);
          console.log(`    Bot Token: ${process.env.TELEGRAM_BOT_TOKEN.substring(0, 10)}...`);
          console.log(`    Chat ID: ${process.env.TELEGRAM_CHAT_ID || 'not set'}`);
          console.log(`    Group ID: ${process.env.TELEGRAM_GROUP_ID || 'not set'}`);
        } else {
          console.log(`  ⚠️  No configuration found`);
        }
      } else if (settings.config && Object.keys(settings.config).length > 0) {
        console.log(`  📋 Configuration present`);
      } else {
        console.log(`  ⚠️  No configuration found`);
      }
      console.log();
    }
  }

  async toggleChannel(channelName) {
    const config = await this.loadConfig();
    
    if (!config[channelName]) {
      console.log(`❌ Channel "${channelName}" not found`);
      return;
    }

    config[channelName].enabled = !config[channelName].enabled;
    await this.saveConfig(config);
    
    console.log(`${channelName}: ${config[channelName].enabled ? '✅ Enabled' : '❌ Disabled'}`);
  }

  async interactiveMenu() {
    console.log('\n🛠️  Claude-Code-Remote Configuration Manager\n');
    
    while (true) {
      console.log('\nChoose an option:');
      console.log('1. Configure Email');
      console.log('2. Configure Telegram');
      console.log('3. Show Current Configuration');
      console.log('4. Toggle Channel (enable/disable)');
      console.log('5. Exit');
      
      const choice = await this.question('\nYour choice (1-5): ');
      
      switch (choice) {
        case '1':
          await this.configureEmail();
          break;
        case '2':
          await this.configureTelegram();
          break;
        case '3':
          await this.showCurrentConfig();
          break;
        case '4':
          const channel = await this.question('Channel name (desktop/email/discord/telegram/whatsapp/feishu): ');
          await this.toggleChannel(channel);
          break;
        case '5':
          console.log('\n👋 Goodbye!');
          this.rl.close();
          return;
        default:
          console.log('Invalid choice. Please try again.');
      }
    }
  }

  close() {
    this.rl.close();
  }
}

// Run as standalone script
if (require.main === module) {
  const manager = new InteractiveConfigManager();
  manager.interactiveMenu().catch(console.error);
}

module.exports = InteractiveConfigManager;