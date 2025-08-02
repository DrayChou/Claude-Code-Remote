# 测试PowerShell调用Claude CLI

Write-Host "🧪 Testing PowerShell Claude CLI call..." -ForegroundColor Green

$claudePath = "C:\Users\dray\scoop\persist\nodejs\bin\claude.ps1"
$command = "echo test"

Write-Host "Claude path: $claudePath"
Write-Host "Command: $command"

# 测试直接调用
Write-Host "📋 Testing direct call..."
& $claudePath $command -p --output-format stream-json --verbose

Write-Host "✅ Test completed" -ForegroundColor Green