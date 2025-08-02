#!/usr/bin/env node

/**
 * 测试 Telegram 消息智能分片功能
 */

console.log('🧪 Testing Telegram Message Splitting');
console.log('====================================\n');

// 模拟 Telegram 频道的分片逻辑
class MessageSplitterTest {
    /**
     * 寻找最佳分割点，复制自实际实现
     */
    _findBestSplitPoint(text, maxLength) {
        if (text.length <= maxLength) {
            return text;
        }
        
        const searchText = text.substring(0, maxLength);
        
        // 优先级列表：越前面优先级越高
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
                // 找到最后一个匹配位置
                const lastMatch = matches[matches.length - 1];
                const splitIndex = lastMatch.index + lastMatch[0].length;
                
                // 确保分割点不会太靠前（至少要有 maxLength 的 60%）
                if (splitIndex >= maxLength * 0.6) {
                    return text.substring(0, splitIndex);
                }
            }
        }
        
        // 如果找不到合适的分割点，强制分割并添加连接符
        return text.substring(0, maxLength - 3) + '...';
    }

    /**
     * 智能分割文本，复制自实际实现
     */
    _splitTextIntoChunks(text, firstChunkMaxLength, subsequentChunkMaxLength) {
        const chunks = [];
        let remainingText = text;
        let isFirstChunk = true;
        
        while (remainingText.length > 0) {
            const maxLength = isFirstChunk ? firstChunkMaxLength : subsequentChunkMaxLength;
            
            if (remainingText.length <= maxLength) {
                // 剩余文本可以放在一个分片中
                chunks.push(remainingText);
                break;
            }
            
            // 寻找最佳分割点
            const chunk = this._findBestSplitPoint(remainingText, maxLength);
            chunks.push(chunk);
            remainingText = remainingText.substring(chunk.length).trim();
            isFirstChunk = false;
        }
        
        return chunks;
    }

    testSplitting() {
        console.log('📋 Testing message splitting logic...\n');
        
        // 测试用例
        const testCases = [
            {
                name: '短消息（无需分割）',
                text: 'This is a short message that should not be split.',
                expected: 1
            },
            {
                name: '段落分隔',
                text: 'First paragraph with some content.\n\nSecond paragraph with more content.\n\nThird paragraph that should be separated nicely.',
                expected: 'variable'
            },
            {
                name: '代码块',
                text: `Here's some code:

\`\`\`javascript
function example() {
    console.log("This is a long function");
    // More code here
    return "result";
}
\`\`\`

And here's the explanation of what this code does. It demonstrates a simple function that logs a message and returns a result.`,
                expected: 'variable'
            },
            {
                name: '中文文本',
                text: '这是一个测试中文分割的例子。我们需要确保中文标点符号也能正确识别。比如逗号，分号；还有句号。这样可以在合适的地方分割长消息。',
                expected: 'variable'
            },
            {
                name: '混合内容',
                text: `I can help you with various software engineering tasks:

**Code Development:**
- Write, edit, and refactor code in any programming language
- Debug and fix issues
- Add new features and functionality
- Optimize performance and code quality

**Project Management:**
- Analyze codebases and understand architecture
- Run tests and build processes
- Manage git repositories (commits, branches, etc.)
- Execute shell commands and scripts

**Remote Control via Email:**
- This system allows you to start tasks locally and receive notifications via email
- You can reply to emails with new commands that I'll execute
- Supports session management for secure remote control`,
                expected: 'variable'
            }
        ];

        for (const testCase of testCases) {
            console.log(`🔍 Test: ${testCase.name}`);
            console.log(`📏 Original length: ${testCase.text.length} chars`);
            
            // 模拟实际的长度限制
            const firstChunkMax = 3000;  // 第一个分片（包含头部后的剩余空间）
            const subsequentChunkMax = 3800; // 后续分片
            
            const chunks = this._splitTextIntoChunks(testCase.text, firstChunkMax, subsequentChunkMax);
            
            console.log(`📦 Split into ${chunks.length} chunks:`);
            
            chunks.forEach((chunk, index) => {
                const chunkInfo = `   Chunk ${index + 1}: ${chunk.length} chars`;
                const preview = chunk.length > 100 ? 
                    chunk.substring(0, 100).replace(/\n/g, '↵') + '...' : 
                    chunk.replace(/\n/g, '↵');
                
                console.log(chunkInfo);
                console.log(`   Preview: "${preview}"`);
                
                // 检查分割点是否合理
                if (index < chunks.length - 1) { // 不是最后一个分片
                    const lastChar = chunk.slice(-1);
                    const splitQuality = this._evaluateSplitQuality(chunk);
                    console.log(`   Split quality: ${splitQuality}`);
                }
                console.log('');
            });
            
            console.log('---\n');
        }
        
        return true;
    }

    _evaluateSplitQuality(chunk) {
        const lastFewChars = chunk.slice(-5);
        
        if (lastFewChars.includes('\n\n')) return '🟢 Excellent (paragraph break)';
        if (lastFewChars.includes('\n')) return '🟡 Good (line break)';
        if (lastFewChars.includes('. ')) return '🟡 Good (sentence end)';
        if (lastFewChars.includes('。')) return '🟡 Good (Chinese sentence end)';
        if (lastFewChars.includes(', ')) return '🟠 Fair (comma)';
        if (lastFewChars.includes(' ')) return '🟠 Fair (word boundary)';
        if (lastFewChars.includes('...')) return '🔴 Forced (no good split point)';
        
        return '🔴 Poor (mid-word split)';
    }
}

async function runTests() {
    console.log('🚀 Starting message splitting tests...\n');
    
    const tester = new MessageSplitterTest();
    const result = tester.testSplitting();
    
    if (result) {
        console.log('✅ All splitting tests completed!');
        console.log('\n📋 Summary of splitting logic:');
        console.log('  1. 🟢 Highest priority: Double line breaks (paragraphs)');
        console.log('  2. 🟡 High priority: Single line breaks');
        console.log('  3. 🟡 Good priority: Sentence endings (. or 。)');
        console.log('  4. 🟠 Medium priority: Commas and other punctuation');
        console.log('  5. 🟠 Low priority: Word boundaries (spaces)');
        console.log('  6. 🔴 Last resort: Force split with ellipsis');
    } else {
        console.log('❌ Some tests failed.');
    }
    
    return result;
}

runTests().catch(console.error);