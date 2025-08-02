# 测试目录结构说明

这个目录包含了 Claude Code Remote 项目的各种测试脚本，按功能分类组织。

## 目录结构

### `/claude/` - Claude CLI 相关测试
- `claude-executor.js` - Claude 执行器基础测试
- `claude-version-test.js` - Claude 版本检查测试
- `detailed-claude-test.js` - 详细的 Claude 功能测试
- `test-spawn-executor.js` - **新版本** spawn 模式执行器测试
- `final-working-test.js` - 最终工作版本测试
- `simple-claude-test.js` - 简单 Claude 测试

### `/powershell/` - PowerShell 调用相关测试
- `direct-powershell-test.js` - 直接 PowerShell 调用测试
- `optimized-powershell-test.js` - 优化的 PowerShell 执行测试
- `test-ps1.ps1` - PowerShell 脚本测试文件

### `/automation/` - 命令注入和自动化测试
- `test-injector.js` - 命令注入器测试
- `test-tmux-injection.js` - Tmux 注入测试
- `test-execution-methods.js` - 执行方法测试
- `windows-direct-executor.js` - Windows 直接执行器

### `/integration/` - 集成测试
- `telegram.test.js` - Telegram 集成测试
- `test-telegram-integration.js` - Telegram 集成功能测试

### `/archive/` - 历史测试文件
包含早期的基础测试和实验性代码，主要用于参考。

## 推荐使用的测试

### 🚀 主要测试脚本
1. **`claude/test-spawn-executor.js`** - 新版本 spawn 模式执行器（推荐）
2. **`powershell/optimized-powershell-test.js`** - 优化的 PowerShell 调用方法
3. **`automation/test-injector.js`** - 命令注入功能测试

### 运行测试

```bash
# 测试新版本 spawn 执行器
node test/claude/test-spawn-executor.js

# 测试 PowerShell 优化版本
node test/powershell/optimized-powershell-test.js

# 测试命令注入功能
node test/automation/test-injector.js
```

## 最新改进

- ✅ 将 `claude-headless-executor.js` 中的 Windows 执行方法从 `exec` 改为更安全的 `spawn`
- ✅ 保持了完整的输出解析和错误处理功能
- ✅ 支持实时流式输出处理
- ✅ 改进了 PowerShell 参数处理，支持普通可执行文件和 .ps1 脚本