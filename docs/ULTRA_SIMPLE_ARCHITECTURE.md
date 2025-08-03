# 极简架构设计 - 两层搞定（最终版本）

## 🎯 核心思路

**只要两层**：平台适配器 + 处理核心
- ✅ **一对一**: 默认原路返回
- ✅ **一对多**: 支持广播到多个出口
- ✅ **独立工作目录**: 每个处理器有自己的工作空间
- ✅ **自定义路由**: 灵活的命令→处理器→目标映射

```
┌─────────────────┐    ┌─────────────────┐
│   平台适配器     │◀──▶│   处理核心       │
│   Adapters      │    │   Core          │
├─────────────────┤    ├─────────────────┤
│ • telegram.py   │    │ • router.py     │
│ • line.py       │    │ • config.yml    │
│ • feishu.py     │    │                 │
│ • discord.py    │    │                 │
└─────────────────┘    └─────────────────┘
```

## 📋 超简单接口设计

### 1. 平台适配器接口

每个平台只需要实现3个函数：

```python
# adapters/base.py
class PlatformAdapter:
    def __init__(self, router):
        self.router = router
    
    async def listen(self):
        """监听消息 - 子类实现"""
        pass
    
    async def send_message(self, chat_id: str, content: str):
        """发送消息 - 子类实现"""  
        pass
    
    async def on_message(self, platform: str, user_id: str, chat_id: str, content: str):
        """收到消息时的通用处理"""
        # 调用路由器处理
        response = await self.router.process(platform, user_id, chat_id, content)
        
        # 发送回复
        for target in response.targets:
            await self.send_to_target(target, response.content)
```

### 2. 具体平台实现

```python
# adapters/telegram.py
class TelegramAdapter(PlatformAdapter):
    async def listen(self):
        # 现有的Telegram轮询逻辑
        while True:
            updates = self.get_updates()
            for update in updates:
                await self.on_message("telegram", user_id, chat_id, content)
    
    async def send_message(self, chat_id: str, content: str):
        # 现有的Telegram发送逻辑
        pass

# adapters/line.py  
class LineAdapter(PlatformAdapter):
    async def listen(self):
        # Line Webhook接收
        pass
    
    async def send_message(self, chat_id: str, content: str):
        # Line API发送
        pass

# adapters/feishu.py
class FeishuAdapter(PlatformAdapter):
    async def listen(self):
        # 飞书Webhook接收
        pass
    
    async def send_message(self, chat_id: str, content: str):
        # 飞书API发送
        pass
```

### 3. 处理核心 (保持不变)

```python
# core/router.py
class MessageRouter:
    def __init__(self, config_file: str):
        self.config = load_config(config_file)
        self.handlers = load_handlers()
        self.adapters = {}  # 注册所有平台适配器
    
    def register_adapter(self, platform: str, adapter):
        """注册平台适配器"""
        self.adapters[platform] = adapter
    
    async def process(self, platform: str, user_id: str, chat_id: str, content: str):
        """处理消息并返回响应目标"""
        # 1. 找到处理器
        handler = self.find_handler(content, user_id)
        
        # 2. 执行处理
        result = await handler.execute(content)
        
        # 3. 决定发送目标
        targets = self.determine_targets(platform, user_id, chat_id, content)
        
        return Response(content=result, targets=targets)
    
    async def send_to_target(self, target: str, content: str):
        """发送到指定目标"""
        # 解析目标格式：platform:chat_id
        platform, chat_id = target.split(":", 1)
        adapter = self.adapters[platform]
        await adapter.send_message(chat_id, content)
```

## 📁 极简目录结构

```
claude-remote/
├── core/
│   ├── router.py       # 路由器
│   ├── handlers.py     # 处理器
│   └── config.py       # 配置加载
│
├── adapters/
│   ├── base.py         # 基础接口
│   ├── telegram.py     # Telegram收发一体
│   ├── line.py         # Line收发一体
│   ├── feishu.py       # 飞书收发一体
│   └── discord.py      # Discord收发一体
│
├── config.yml          # 配置文件
├── main.py             # 主程序
└── requirements.txt
```

## 🔧 主程序 (`main.py`)

```python
import asyncio
from core.router import MessageRouter
from adapters.telegram import TelegramAdapter
from adapters.line import LineAdapter
from adapters.feishu import FeishuAdapter

async def main():
    # 创建路由器
    router = MessageRouter("config.yml")
    
    # 创建并注册平台适配器
    telegram = TelegramAdapter(router)
    line = LineAdapter(router) 
    feishu = FeishuAdapter(router)
    
    router.register_adapter("telegram", telegram)
    router.register_adapter("line", line)
    router.register_adapter("feishu", feishu)
    
    # 启动所有平台监听
    await asyncio.gather(
        telegram.listen(),
        line.listen(),
        feishu.listen()
    )

if __name__ == "__main__":
    asyncio.run(main())
```

## ⚙️ 配置文件 (支持一对多路由)

```yaml
# config.yml
routes:
  default: "claude"
  commands:
    # 一对一路由
    "/claude":
      handler: "claude"
      targets: ["origin"]  # 原路返回
      
    "/gpt":
      handler: "openai"
      targets: ["origin"]
      
    # 一对多路由（广播）
    "/all":
      handler: "claude"
      targets: ["origin", "telegram:123456789", "feishu:dev_group"]
      
    "/dev":
      handler: "claude_dev"
      targets: ["origin", "telegram:dev_chat", "line:dev_user"]

handlers:
  claude:
    type: "shell"
    command: "claude"
    args: ["{content}", "-p"]
    working_dir: "/default/workspace"
    
  openai:
    type: "api"
    api_key: "${OPENAI_API_KEY}"
    working_dir: "/openai/workspace"
    
  claude_dev:
    type: "shell"
    command: "claude"
    args: ["{content}", "-p"]
    working_dir: "/dev/project"

platforms:
  telegram:
    bot_token: "${TELEGRAM_BOT_TOKEN}"
    allowed_user_ids: [123456789]
    
  line:
    channel_secret: "${LINE_CHANNEL_SECRET}"
    channel_access_token: "${LINE_CHANNEL_ACCESS_TOKEN}"
    
  feishu:
    app_id: "${FEISHU_APP_ID}"
    app_secret: "${FEISHU_APP_SECRET}"

# 目标别名
target_aliases:
  dev_group: "feishu:group_123"
  dev_chat: "telegram:-1001234567890"
  dev_user: "line:user_456"
```

## 🚀 新增平台超简单

添加新平台只需要3步：

### 1. 继承基类
```python
# adapters/wechat.py
class WechatAdapter(PlatformAdapter):
    async def listen(self):
        # 微信监听逻辑
        pass
    
    async def send_message(self, chat_id: str, content: str):
        # 微信发送逻辑
        pass
```

### 2. 注册到主程序
```python
# main.py
wechat = WechatAdapter(router)
router.register_adapter("wechat", wechat)
```

### 3. 添加配置
```yaml
# config.yml
platforms:
  wechat:
    app_id: "${WECHAT_APP_ID}"
```

## 💡 关键优势

1. **入口出口合一**: 每个平台一个文件搞定收发
2. **接口极简**: 只需实现2个方法（listen + send_message）
3. **一对多路由**: 支持广播消息到多个平台/用户
4. **独立工作空间**: 每个处理器有自己的工作目录
5. **配置统一**: 一个YAML文件管理所有路由和处理器
6. **零学习成本**: 现有代码直接迁移
7. **扩展容易**: 新平台3步搞定

## 🚀 新功能特性

### 一对多广播示例
```yaml
"/notify":
  handler: "notification_script"  
  targets: ["telegram:admin", "feishu:dev_group", "email:admin@company.com"]
```

### 每个处理器独立工作目录
```yaml
handlers:
  claude_dev:
    working_dir: "/dev/project"
  claude_prod:
    working_dir: "/prod/workspace"
  openai:
    working_dir: "/openai/temp"
```

## 📈 迁移超简单

### Step 1: 重构Telegram
```python
# 把现有 telegram_bot.py 改为 adapters/telegram.py
# 只需要把类名改为 TelegramAdapter 并继承 PlatformAdapter
```

### Step 2: 抽取处理逻辑
```python
# 把Claude调用逻辑移到 core/handlers.py
```

### Step 3: 添加新平台
```python
# 复制telegram适配器，修改API调用即可
```

## 🎯 实际使用示例

### 多项目Claude命令
现在你可以通过不同命令在不同项目目录下执行Claude：

```yaml
# config.yml
routes:
  commands:
    "cc.a1":      # 在项目A1目录下执行Claude
      handler: "claude_a1"
      targets: ["origin"]
    "cc.a2":      # 在项目A2目录下执行Claude  
      handler: "claude_a2"
      targets: ["origin"]

handlers:
  claude_a1:
    type: "shell"
    command: "claude"
    args: ["{content}", "-p"]
    working_dir: "D:/Code/ProjectA1"  # A1项目目录
    
  claude_a2:
    type: "shell" 
    command: "claude"
    args: ["{content}", "-p"]
    working_dir: "D:/Code/ProjectA2"  # A2项目目录
```

### 使用方法：
- 发送 `cc.a1 分析代码` → 在ProjectA1目录下执行Claude
- 发送 `cc.a2 检查错误` → 在ProjectA2目录下执行Claude  
- 发送 `/all 项目状态` → 广播到多个平台

### 一对多广播示例：
```yaml
"/notify":
  handler: "claude"
  targets: ["origin", "telegram:admin", "feishu:dev_group", "line:team_lead"]
```

发送 `/notify 系统维护通知` 会同时发送到：
- 原聊天（origin）
- Telegram管理员
- 飞书开发群
- Line团队负责人

这样设计怎么样？**入口出口合并，接口超简单，扩展零门槛，支持一对多路由**！