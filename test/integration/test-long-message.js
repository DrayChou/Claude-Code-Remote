#!/usr/bin/env node

/**
 * 测试长消息分片功能（使用真实长度）
 */

console.log('🧪 Testing Long Message Splitting');
console.log('=================================\n');

// 复制分片逻辑
class LongMessageTest {
    _findBestSplitPoint(text, maxLength) {
        if (text.length <= maxLength) {
            return text;
        }
        
        const searchText = text.substring(0, maxLength);
        
        const splitPatterns = [
            /\n\n/g,           // 双换行（段落分隔）
            /\n/g,             // 单换行
            /\. /g,            // 句号后空格
            /\.\n/g,           // 句号后换行
            /, /g,             // 逗号后空格
            /，/g,             // 中文逗号
            /；/g,             // 中文分号
            /。/g,             // 中文句号
            / /g               // 空格
        ];
        
        for (const pattern of splitPatterns) {
            const matches = [...searchText.matchAll(pattern)];
            if (matches.length > 0) {
                const lastMatch = matches[matches.length - 1];
                const splitIndex = lastMatch.index + lastMatch[0].length;
                
                if (splitIndex >= maxLength * 0.6) {
                    return text.substring(0, splitIndex);
                }
            }
        }
        
        return text.substring(0, maxLength - 3) + '...';
    }

    _splitTextIntoChunks(text, firstChunkMaxLength, subsequentChunkMaxLength) {
        const chunks = [];
        let remainingText = text;
        let isFirstChunk = true;
        
        while (remainingText.length > 0) {
            const maxLength = isFirstChunk ? firstChunkMaxLength : subsequentChunkMaxLength;
            
            if (remainingText.length <= maxLength) {
                chunks.push(remainingText);
                break;
            }
            
            const chunk = this._findBestSplitPoint(remainingText, maxLength);
            chunks.push(chunk);
            remainingText = remainingText.substring(chunk.length).trim();
            isFirstChunk = false;
        }
        
        return chunks;
    }

    testLongMessage() {
        // 创建一个很长的消息模拟 Claude 的详细回复
        const longResponse = `我分析了当前项目的修改情况，以下是详细的文件变更列表：

## 核心功能修改

### src/relay/claude-headless-executor.js
**主要变更：**
- 将 Windows PowerShell 执行方法从 exec 改为 spawn 提高安全性和性能
- 添加了详细的调试日志记录
- 改进了超时处理机制，从 10 分钟缩短到 45 秒
- 新增 _extractResponseFromOutput 方法用于更好的响应提取
- 修复了参数传递格式，确保 PowerShell 脚本参数正确传递
- 添加了进程状态监控和更好的错误处理

### src/channels/chat/telegram.js
**主要变更：**
- 实现了自动 session 创建功能，解决首次输入无 session 问题
- 修复了 token 变量作用域问题，确保正确传递
- 添加了智能消息分片功能，支持长消息的合理分割
- 简化了消息流程，移除了复杂的流式处理避免编辑失败
- 改进了错误处理和超时机制
- 新增 _sendLongMessage 和 _splitTextIntoChunks 方法

## 测试文件变更

### test/ 目录重组
- 将根目录的测试文件按功能分类移动到 test/ 子目录
- 创建了 claude/, powershell/, automation/, integration/ 等分类目录
- 添加了新的测试文件验证修复功能

### 新增测试文件：
- test/claude/test-spawn-executor.js - 测试新的 spawn 执行器
- test/integration/test-telegram-fixes.js - 验证 Telegram 修复
- test/integration/test-token-fix.js - 验证 token 传递修复

## 配置和文档

### test/README.md
- 新增测试目录说明文档
- 描述了各个测试分类和推荐使用的测试脚本
- 记录了最新的改进和修复

## 性能优化

### 超时和响应处理优化：
1. **执行超时**：从 180 秒缩短到 60 秒，提供更快反馈
2. **PowerShell 进程超时**：从 10 分钟缩短到 45 秒
3. **消息处理**：简化流程，减少 API 调用失败

### 安全性提升：
1. **spawn vs exec**：使用 spawn 避免命令注入风险
2. **参数分离**：PowerShell 参数和用户输入分开处理
3. **输入验证**：改进了命令验证和过滤机制

## 用户体验改进

### Telegram 机器人功能：
1. **自动 session 创建**：用户无需等待通知即可发送命令
2. **智能消息分片**：长回复自动在合适位置分割发送
3. **更清晰的消息流程**：处理中 → 完成结果，避免混乱
4. **更好的错误处理**：即使超时也能返回有用信息

### 开发体验优化：
1. **详细的调试日志**：更容易定位问题
2. **更好的测试组织**：按功能分类的测试结构
3. **文档完善**：详细的 README 和使用说明

这些修改显著提升了系统的可靠性、性能和用户体验，解决了之前存在的 session 创建、消息传递、超时处理等关键问题。`;

        console.log('📝 Testing with realistic long response...');
        console.log(`📏 Total length: ${longResponse.length} chars\n`);

        // 模拟实际的 Telegram 限制和头部信息
        const header = `✅ **Command completed**\n\n📝 **Command:** 列一下当前项目里修改了什么文件？\n⏱️ **Duration:** 14023ms\n🔧 **Method:** windows-powershell-spawn\n\n**Claude Response:**\n`;
        
        console.log(`📋 Header length: ${header.length} chars`);
        
        const firstChunkMaxLength = 3896 - header.length; // 3896 = 4096 - 200 (reserved)
        const subsequentChunkMaxLength = 3996; // 3996 = 4096 - 100 (reserved for part info)
        
        console.log(`📦 First chunk max: ${firstChunkMaxLength} chars`);
        console.log(`📦 Subsequent chunks max: ${subsequentChunkMaxLength} chars\n`);

        const chunks = this._splitTextIntoChunks(longResponse, firstChunkMaxLength, subsequentChunkMaxLength);
        
        console.log(`🔢 Split into ${chunks.length} chunks:\n`);
        
        chunks.forEach((chunk, index) => {
            console.log(`📄 Part ${index + 1} of ${chunks.length}:`);
            console.log(`   Length: ${chunk.length} chars`);
            
            // 显示分割点信息
            if (index < chunks.length - 1) {
                const endChars = chunk.slice(-10).replace(/\n/g, '↵');
                console.log(`   Ends with: "${endChars}"`);
                console.log(`   Split quality: ${this._evaluateSplitQuality(chunk)}`);
            }
            
            // 显示开头和结尾
            const start = chunk.substring(0, 80).replace(/\n/g, '↵');
            const end = chunk.length > 80 ? '...' + chunk.slice(-30).replace(/\n/g, '↵') : '';
            console.log(`   Content: "${start}${end}"`);
            console.log('');
        });

        // 验证分片后总长度
        const totalCharsAfterSplit = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
        const originalLength = longResponse.length;
        
        console.log('📊 Verification:');
        console.log(`   Original: ${originalLength} chars`);
        console.log(`   After split: ${totalCharsAfterSplit} chars`);
        console.log(`   Difference: ${originalLength - totalCharsAfterSplit} chars (should be minimal)`);
        
        return chunks.length > 1; // 应该被分割
    }

    _evaluateSplitQuality(chunk) {
        const lastFewChars = chunk.slice(-5);
        
        if (lastFewChars.includes('\n\n')) return '🟢 Excellent (paragraph)';
        if (lastFewChars.includes('\n')) return '🟡 Good (line break)';
        if (lastFewChars.includes('. ')) return '🟡 Good (sentence)';
        if (lastFewChars.includes('。')) return '🟡 Good (Chinese sentence)';
        if (lastFewChars.includes(', ')) return '🟠 Fair (comma)';
        if (lastFewChars.includes(' ')) return '🟠 Fair (word boundary)';
        if (lastFewChars.includes('...')) return '🔴 Forced split';
        
        return '🔴 Poor split';
    }
}

const tester = new LongMessageTest();
const result = tester.testLongMessage();

if (result) {
    console.log('\n✅ Long message splitting test passed!');
    console.log('🎯 Messages will be split intelligently at natural break points.');
} else {
    console.log('\n❌ Test failed - message should have been split.');
}