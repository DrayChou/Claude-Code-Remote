#!/usr/bin/env node

/**
 * Claude-Code-Remote Daemon Service
 * Background daemon process for monitoring emails and processing remote commands
 */

const fs = require('fs');
const path = require('path');
const { spawn, exec } = require('child_process');
const Logger = require('../core/logger');
const ConfigManager = require('../core/config');
const PidManager = require('../utils/pid-manager');

class ClaudeCodeRemoteDaemon {
    constructor() {
        this.logger = new Logger('Daemon');
        this.config = new ConfigManager();
        this.pidManager = new PidManager('claude-remote-daemon');
        this.pidFile = this.pidManager.getPidFilePath(); // 使用PidManager的路径
        this.logFile = path.join(__dirname, '../data/daemon.log');
        this.relayService = null;
        this.isRunning = false;
        
        // Ensure data directory exists
        const dataDir = path.dirname(this.pidFile);
        if (!fs.existsSync(dataDir)) {
            fs.mkdirSync(dataDir, { recursive: true });
        }
    }

    async start(detached = true) {
        try {
            // 使用PidManager清理旧进程
            console.log('🔍 Checking for existing daemon processes...');
            if (this.pidManager.hasRunningInstances()) {
                console.log('⚡ Found running instances, cleaning up...');
                this.pidManager.cleanupOldProcesses();
            }

            if (detached) {
                // Start in daemon mode
                await this.startDetached();
            } else {
                // Run directly in current process
                await this.startForeground();
            }
        } catch (error) {
            this.logger.error('Failed to start daemon:', error);
            throw error;
        }
    }

    async startDetached() {
        console.log('🚀 Starting Claude-Code-Remote daemon...');

        // Create child process
        const child = spawn(process.execPath, [__filename, '--foreground'], {
            detached: true,
            stdio: ['ignore', 'pipe', 'pipe']
        });

        // Redirect logs
        const logStream = fs.createWriteStream(this.logFile, { flags: 'a' });
        child.stdout.pipe(logStream);
        child.stderr.pipe(logStream);

        // 使用PidManager注册子进程
        const tempPidManager = new PidManager('claude-remote-daemon');
        tempPidManager._writePidFile([child.pid], {
            detached: true,
            command: 'daemon start',
            logFile: this.logFile
        });

        // Detach child process
        child.unref();

        console.log(`✅ Claude-Code-Remote daemon started (PID: ${child.pid})`);
        console.log(`📝 Log file: ${this.logFile}`);
        console.log('💡 Use "claude-remote daemon status" to view status');
        console.log('💡 Use "claude-remote daemon stop" to stop service');
    }

    async startForeground() {
        console.log('🚀 Claude-Code-Remote daemon starting...');
        
        // 注册当前进程
        this.pidManager.registerCurrentProcess({
            foreground: true,
            command: 'daemon --foreground'
        });
        
        this.isRunning = true;
        process.title = 'claude-code-remote-daemon';

        // Load configuration
        this.config.load();
        
        // Initialize email relay service
        const emailConfig = this.config.getChannel('email');
        if (!emailConfig || !emailConfig.enabled) {
            this.logger.warn('Email channel not configured or disabled');
            return;
        }

        const CommandRelayService = require('../relay/command-relay');
        this.relayService = new CommandRelayService(emailConfig.config);

        // Setup event handlers
        this.setupEventHandlers();

        // Start service
        await this.relayService.start();
        this.logger.info('Email relay service started');

        // Keep process running
        this.keepAlive();
    }

    setupEventHandlers() {
        // Graceful shutdown
        const gracefulShutdown = async (signal) => {
            this.logger.info(`Received ${signal}, shutting down gracefully...`);
            this.isRunning = false;
            
            if (this.relayService) {
                await this.relayService.stop();
            }
            
            // 使用PidManager清理PID文件
            this.pidManager.cleanup();
            
            process.exit(0);
        };

        process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
        process.on('SIGINT', () => gracefulShutdown('SIGINT'));
        process.on('SIGHUP', () => {
            this.logger.info('Received SIGHUP, reloading configuration...');
            this.config.load();
        });

        // Relay service events
        if (this.relayService) {
            this.relayService.on('started', () => {
                this.logger.info('Command relay service started');
            });

            this.relayService.on('commandQueued', (command) => {
                this.logger.info(`Command queued: ${command.id}`);
            });

            this.relayService.on('commandExecuted', (command) => {
                this.logger.info(`Command executed: ${command.id}`);
            });

            this.relayService.on('commandFailed', (command, error) => {
                this.logger.error(`Command failed: ${command.id} - ${error.message}`);
            });
        }

        // Uncaught exception handling
        process.on('uncaughtException', (error) => {
            this.logger.error('Uncaught exception:', error);
            process.exit(1);
        });

        process.on('unhandledRejection', (reason, promise) => {
            this.logger.error('Unhandled rejection at:', promise, 'reason:', reason);
            process.exit(1);
        });
    }

    keepAlive() {
        // Keep process running
        const heartbeat = setInterval(() => {
            if (!this.isRunning) {
                clearInterval(heartbeat);
                return;
            }
            this.logger.debug('Heartbeat');
        }, 60000); // Output heartbeat log every minute
    }

    async stop() {
        if (!this.pidManager.hasRunningInstances()) {
            console.log('❌ Claude-Code-Remote daemon is not running');
            return;
        }

        try {
            console.log('🛑 Stopping Claude-Code-Remote daemon...');
            
            // 使用PidManager清理所有相关进程
            this.pidManager.cleanupOldProcesses();
            
            console.log('✅ Claude-Code-Remote daemon stopped');
        } catch (error) {
            console.error('❌ Failed to stop daemon:', error.message);
            
            // 强制清理PID文件
            this.pidManager.cleanup();
            console.log('🧹 PID file cleaned up');
        }
    }

    async restart() {
        console.log('🔄 Restarting Claude-Code-Remote daemon...');
        await this.stop();
        await new Promise(resolve => setTimeout(resolve, 2000)); // Wait 2 seconds
        await this.start();
    }

    getStatus() {
        const hasRunning = this.pidManager.hasRunningInstances();
        const pids = hasRunning ? this.pidManager._readPidFile() : [];
        
        return {
            running: hasRunning,
            pids: pids,
            pidFile: this.pidFile,
            logFile: this.logFile,
            uptime: pids.length > 0 ? this.getUptime(pids[0]) : null
        };
    }

    showStatus() {
        const status = this.getStatus();
        
        console.log('📊 Claude-Code-Remote daemon status\n');
        
        if (status.running) {
            console.log('✅ Status: Running');
            console.log(`🆔 PIDs: ${status.pids.join(', ')}`);
            console.log(`⏱️ Uptime: ${status.uptime || 'Unknown'}`);
        } else {
            console.log('❌ Status: Not running');
        }
        
        console.log(`📝 Log file: ${status.logFile}`);
        console.log(`📁 PID file: ${status.pidFile}`);
        
        // Show recent logs
        if (fs.existsSync(status.logFile)) {
            console.log('\n📋 Recent logs:');
            try {
                const logs = fs.readFileSync(status.logFile, 'utf8');
                const lines = logs.split('\n').filter(line => line.trim()).slice(-5);
                lines.forEach(line => console.log(`  ${line}`));
            } catch (error) {
                console.log('  Unable to read log file');
            }
        }
    }

    // 这些方法现在由PidManager处理，保留作为兼容性方法
    isAlreadyRunning() {
        return this.pidManager.hasRunningInstances();
    }

    getPid() {
        const pids = this.pidManager._readPidFile();
        return pids.length > 0 ? pids[0] : null;
    }

    async waitForStop(pid, timeout = 10000) {
        const startTime = Date.now();
        
        while (Date.now() - startTime < timeout) {
            try {
                process.kill(pid, 0);
                await new Promise(resolve => setTimeout(resolve, 100));
            } catch (error) {
                // Process has stopped
                return;
            }
        }
        
        // Timeout, force termination
        throw new Error('Process stop timeout, may need manual termination');
    }

    getUptime(pid) {
        try {
            const { execSync } = require('child_process');
            const os = require('os');
            const platform = os.platform();
            
            let result;
            
            if (platform === 'win32') {
                // Windows: 使用 PowerShell 获取进程创建时间，更可靠
                result = execSync(`powershell.exe -Command "Get-Process -Id ${pid} | Select-Object StartTime"`, { 
                    encoding: 'utf8' 
                });
                
                // 解析PowerShell输出
                const lines = result.split('\n').filter(line => line.trim() && !line.includes('StartTime') && !line.includes('---'));
                if (lines.length > 0) {
                    const startTimeStr = lines[0].trim();
                    if (startTimeStr && startTimeStr !== '') {
                        const startTime = new Date(startTimeStr);
                        const uptime = Date.now() - startTime.getTime();
                        
                        const hours = Math.floor(uptime / (1000 * 60 * 60));
                        const minutes = Math.floor((uptime % (1000 * 60 * 60)) / (1000 * 60));
                        
                        return `${hours}h ${minutes}m`;
                    }
                }
            } else {
                // macOS/Linux: 使用 ps 命令
                result = execSync(`ps -o lstart= -p ${pid}`, { encoding: 'utf8' });
                const startTime = new Date(result.trim());
                const uptime = Date.now() - startTime.getTime();
                
                const hours = Math.floor(uptime / (1000 * 60 * 60));
                const minutes = Math.floor((uptime % (1000 * 60 * 60)) / (1000 * 60));
                
                return `${hours}h ${minutes}m`;
            }
            
            return 'Unknown';
        } catch (error) {
            return 'Unknown';
        }
    }
}

// Command line interface
if (require.main === module) {
    const daemon = new ClaudeCodeRemoteDaemon();
    const command = process.argv[2];

    (async () => {
        try {
            switch (command) {
                case 'start':
                    await daemon.start(true);
                    break;
                case '--foreground':
                    await daemon.start(false);
                    break;
                case 'stop':
                    await daemon.stop();
                    break;
                case 'restart':
                    await daemon.restart();
                    break;
                case 'status':
                    daemon.showStatus();
                    break;
                default:
                    console.log('Usage: claude-code-remote-daemon <start|stop|restart|status>');
                    process.exit(1);
            }
        } catch (error) {
            console.error('Error:', error.message);
            process.exit(1);
        }
    })();
}

module.exports = ClaudeCodeRemoteDaemon;