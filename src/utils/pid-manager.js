/**
 * PID Manager - 管理进程 ID 文件，防止多实例冲突
 * 支持 Windows、Linux、macOS 多平台
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const os = require('os');

class PidManager {
    constructor(serviceName = 'claude-remote') {
        this.serviceName = serviceName;
        this.pidFile = path.join(__dirname, '../data', `${serviceName}.pid`);
        this.dataDir = path.dirname(this.pidFile);
        this.platform = os.platform(); // 'win32', 'darwin', 'linux'
        
        // 确保数据目录存在
        this._ensureDataDir();
    }

    _ensureDataDir() {
        if (!fs.existsSync(this.dataDir)) {
            fs.mkdirSync(this.dataDir, { recursive: true });
        }
    }

    /**
     * 跨平台检查进程是否正在运行
     */
    _isProcessRunning(pid) {
        try {
            if (this.platform === 'win32') {
                // Windows: 使用简单的 kill 信号检查，避免cmd编码问题
                process.kill(pid, 0);
                return true;
            } else {
                // Linux/macOS: 使用 kill -0 信号检查
                process.kill(pid, 0);
                return true;
            }
        } catch (error) {
            return false;
        }
    }

    /**
     * 跨平台检查 PID 是否是 Node.js 进程
     */
    _isNodeProcess(pid) {
        try {
            if (this.platform === 'win32') {
                // Windows: 检查进程的可执行文件路径
                const result = execSync(`powershell.exe -Command "Get-Process -Id ${pid} | Select-Object ProcessName"`, { 
                    encoding: 'utf8',
                    stdio: 'pipe'
                });
                return result.toLowerCase().includes('node');
            } else if (this.platform === 'darwin') {
                // macOS: 使用 ps 检查进程命令
                const result = execSync(`ps -p ${pid} -o comm=`, { 
                    encoding: 'utf8',
                    stdio: 'pipe'
                });
                return result.toLowerCase().includes('node');
            } else {
                // Linux: 使用 ps 检查进程命令
                const result = execSync(`ps -p ${pid} -o comm=`, { 
                    encoding: 'utf8',
                    stdio: 'pipe'
                });
                return result.toLowerCase().includes('node');
            }
        } catch (error) {
            return false;
        }
    }

    /**
     * 跨平台强制终止进程
     */
    _killProcess(pid) {
        try {
            if (this.platform === 'win32') {
                // Windows: 使用 PowerShell 终止进程，更可靠
                execSync(`powershell.exe -Command "Stop-Process -Id ${pid} -Force"`, { stdio: 'ignore' });
            } else {
                // Linux/macOS: 使用 kill
                execSync(`kill -TERM ${pid}`, { stdio: 'ignore' });
                
                // 等待一秒后检查进程是否还在运行
                setTimeout(() => {
                    if (this._isProcessRunning(pid)) {
                        // 如果还在运行，使用 KILL 信号强制终止
                        try {
                            execSync(`kill -KILL ${pid}`, { stdio: 'ignore' });
                        } catch (error) {
                            // 忽略错误，进程可能已经被终止
                        }
                    }
                }, 1000);
            }
            return true;
        } catch (error) {
            return false;
        }
    }

    /**
     * 读取 PID 文件中的进程 ID 列表
     */
    _readPidFile() {
        try {
            if (!fs.existsSync(this.pidFile)) {
                return [];
            }

            const content = fs.readFileSync(this.pidFile, 'utf8');
            const data = JSON.parse(content);
            
            return Array.isArray(data.pids) ? data.pids : [];
        } catch (error) {
            console.warn(`⚠️  Failed to read PID file: ${error.message}`);
            return [];
        }
    }

    /**
     * 写入PID文件
     */
    _writePidFile(pids, metadata = {}) {
        try {
            const data = {
                service: this.serviceName,
                timestamp: new Date().toISOString(),
                currentPid: process.pid,
                pids: pids,
                ...metadata
            };

            fs.writeFileSync(this.pidFile, JSON.stringify(data, null, 2));
            return true;
        } catch (error) {
            console.error(`❌ Failed to write PID file: ${error.message}`);
            return false;
        }
    }

    /**
     * 清理旧的进程实例
     */
    cleanupOldProcesses() {
        console.log(`🔍 Checking for existing processes (${this._getPlatformName()})...`);
        
        const oldPids = this._readPidFile();
        let cleanedCount = 0;

        if (oldPids.length === 0) {
            console.log('✅ No previous processes found');
            return true;
        }

        console.log(`📋 Found ${oldPids.length} previous process(es) to check`);

        for (const pid of oldPids) {
            if (pid === process.pid) {
                // 跳过当前进程
                continue;
            }

            console.log(`🔍 Checking PID ${pid}...`);

            if (!this._isProcessRunning(pid)) {
                console.log(`   💀 Process ${pid} is not running (already stopped)`);
                continue;
            }

            if (!this._isNodeProcess(pid)) {
                console.log(`   ⚠️  Process ${pid} is not a Node.js process, skipping`);
                continue;
            }

            console.log(`   🎯 Terminating Node.js process ${pid}...`);
            if (this._killProcess(pid)) {
                console.log(`   ✅ Successfully terminated process ${pid}`);
                cleanedCount++;
            } else {
                console.log(`   ❌ Failed to terminate process ${pid}`);
            }
        }

        if (cleanedCount > 0) {
            console.log(`🧹 Cleanup completed: ${cleanedCount} process(es) terminated`);
        } else {
            console.log('✅ No processes needed cleanup');
        }

        return true;
    }

    /**
     * 注册当前进程
     */
    registerCurrentProcess(metadata = {}) {
        console.log(`📝 Registering current process (PID: ${process.pid})`);
        
        // 先清理旧进程
        this.cleanupOldProcesses();
        
        // 注册当前进程
        const success = this._writePidFile([process.pid], {
            command: process.argv.join(' '),
            ...metadata
        });

        if (success) {
            console.log('✅ Process registered successfully');
        } else {
            console.error('❌ Failed to register process');
        }

        return success;
    }

    /**
     * 清理PID文件（通常在进程退出时调用）
     */
    cleanup() {
        try {
            if (fs.existsSync(this.pidFile)) {
                fs.unlinkSync(this.pidFile);
                console.log('🗑️  PID file cleaned up');
            }
        } catch (error) {
            console.warn(`⚠️  Failed to cleanup PID file: ${error.message}`);
        }
    }

    /**
     * 获取PID文件路径
     */
    getPidFilePath() {
        return this.pidFile;
    }

    /**
     * 检查是否有其他实例在运行
     */
    hasRunningInstances() {
        const pids = this._readPidFile();
        
        for (const pid of pids) {
            if (pid !== process.pid && this._isProcessRunning(pid) && this._isNodeProcess(pid)) {
                return true;
            }
        }
        
        return false;
    }
    
    /**
     * 获取平台友好名称
     */
    _getPlatformName() {
        switch (this.platform) {
            case 'win32': return 'Windows';
            case 'darwin': return 'macOS';
            case 'linux': return 'Linux';
            default: return this.platform;
        }
    }
}

module.exports = PidManager;