# 自动世界喊话 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 定时在世界频道发送用户自定义消息，与其他 action 互斥（参照 autoExplore 模式）。

**Architecture:** 新建 sendWorldChat action，首次点击聊天区域 → 输入框 → adb input text 输入 → 发送。后续循环从输入框开始（聊天面板保持打开）。Home.tsx 添加独立循环 + UI 卡片，互斥逻辑与 autoExplore 一致。

**Tech Stack:** TypeScript + ADB + React

---

### Task 1: 新建 sendWorldChat action

**Files:**
- Create: `plugins/rok/actions/sendWorldChat.ts`

```typescript
import { PluginContext } from '../../../core/plugin';
import { RokConfig } from '../index';

export async function sendWorldChat(
  ctx: PluginContext,
  config: RokConfig,
  message: string
): Promise<void> {
  const wc = config.worldChat;
  ctx.log(`=== 发送世界喊话 ===`);
  ctx.log(`  消息: ${message}`);

  // 点击输入框
  ctx.log(`  [1/3] 点击输入框 (${wc.inputBox.x}, ${wc.inputBox.y})`);
  await ctx.tap(wc.inputBox.x, wc.inputBox.y);
  await ctx.sleep(0.5);

  // 通过 ADB shell input text 输入消息内容
  ctx.log(`  [2/3] 输入消息`);
  const escaped = message.replace(/"/g, '\\"').replace(/'/g, "\\'");
  await ctx.device.shell(`input text "${escaped}"`);
  await ctx.sleep(0.3);

  // 点击发送
  ctx.log(`  [3/3] 点击发送 (${wc.sendButton.x}, ${wc.sendButton.y})`);
  await ctx.tap(wc.sendButton.x, wc.sendButton.y);
  await ctx.sleep(0.5);

  ctx.log(`✅ 喊话发送完成`);
}

export async function sendWorldChatFirstRun(
  ctx: PluginContext,
  config: RokConfig,
  message: string
): Promise<void> {
  const wc = config.worldChat;
  ctx.log(`=== 首次发送世界喊话 ===`);
  ctx.log(`  消息: ${message}`);

  // 点击聊天区域打开聊天面板
  ctx.log(`  [1/4] 打开聊天面板 (${wc.chatButton.x}, ${wc.chatButton.y})`);
  await ctx.tap(wc.chatButton.x, wc.chatButton.y);
  await ctx.sleep(1);

  // 点击输入框
  ctx.log(`  [2/4] 点击输入框 (${wc.inputBox.x}, ${wc.inputBox.y})`);
  await ctx.tap(wc.inputBox.x, wc.inputBox.y);
  await ctx.sleep(0.5);

  // 输入消息
  ctx.log(`  [3/4] 输入消息`);
  const escaped = message.replace(/"/g, '\\"').replace(/'/g, "\\'");
  await ctx.device.shell(`input text "${escaped}"`);
  await ctx.sleep(0.3);

  // 点击发送
  ctx.log(`  [4/4] 点击发送 (${wc.sendButton.x}, ${wc.sendButton.y})`);
  await ctx.tap(wc.sendButton.x, wc.sendButton.y);
  await ctx.sleep(0.5);

  ctx.log(`✅ 首次喊话发送完成`);
}
```

- [ ] **Commit**

```bash
git add plugins/rok/actions/sendWorldChat.ts
git commit -m "feat: add sendWorldChat action"
```

---

### Task 2: 修改 homeFeatures.ts — 新增喊话字段

**Files:**
- Modify: `plugins/rok/homeFeatures.ts`

在 `HomeFeatures` interface 中新增 3 个字段：

```typescript
export interface HomeFeatures {
  // ... 现有字段 ...
  autoWorldChat: boolean;
  worldChatMessage: string;
  worldChatInterval: number;
}
```

在 `DEFAULT_HOME_FEATURES` 中新增默认值：

```typescript
export const DEFAULT_HOME_FEATURES: HomeFeatures = {
  // ... 现有默认值 ...
  autoWorldChat: false,
  worldChatMessage: '',
  worldChatInterval: 300,
};
```

- [ ] **Commit**

```bash
git add plugins/rok/homeFeatures.ts
git commit -m "feat: add autoWorldChat fields to HomeFeatures"
```

---

### Task 3: 修改 index.ts — 注册 action + RokConfig 新增坐标

**Files:**
- Modify: `plugins/rok/index.ts`

**3a. Import 新增：**

```typescript
import { sendWorldChat, sendWorldChatFirstRun } from './actions/sendWorldChat';
```

**3b. RokConfig interface 新增：**

```typescript
worldChat: {
  chatButton: { x: number; y: number };
  inputBox: { x: number; y: number };
  sendButton: { x: number; y: number };
};
```

**3c. DEFAULT_ROK_CONFIG 新增默认值：**

```typescript
worldChat: {
  chatButton: { x: 418, y: 845 },
  inputBox: { x: 601, y: 837 },
  sendButton: { x: 1518, y: 848 },
},
```

**3d. actions 数组新增：**

```typescript
{
  id: 'send-world-chat',
  name: '发送世界喊话',
  description: '在世界频道发送用户预设的消息',
  run: async (ctx, params: { message: string; isFirst?: boolean }) => {
    const config = ctx.getConfig('rokConfig', DEFAULT_ROK_CONFIG);
    if (params.isFirst) {
      await sendWorldChatFirstRun(ctx, config, params.message);
    } else {
      await sendWorldChat(ctx, config, params.message);
    }
  }
},
```

- [ ] **Commit**

```bash
git add plugins/rok/index.ts
git commit -m "feat: register send-world-chat action + worldChat config"
```

---

### Task 4: 修改 Home.tsx — UI 卡片 + 喊话循环 + 互斥

**Files:**
- Modify: `web/src/pages/Home.tsx`

**4a. 导入 features 时包含新字段。** 在现有 `const { ... } = features;` 解构中确认 `autoWorldChat`, `worldChatMessage`, `worldChatInterval` 已包含（通过 loadFeatures 从 configService 加载，无需额外解构）。

**4b. 主循环新增喊话模式（参照 explore 模式），紧接在 explore 模式之后：**

```typescript
// 喊话模式：与其他任务互斥，只执行世界喊话
if (features.autoWorldChat) {
  if (acquireLock && !(await acquireLock())) break;
  try {
    await runTask('send-world-chat', {
      message: features.worldChatMessage,
      isFirst: true
    });
  } finally { releaseLock?.(); }

  while (!loopStopped && features.autoWorldChat) {
    const chatInterval = features.worldChatInterval || 300;
    const nextWake = chatInterval * (0.85 + Math.random() * 0.3);
    const chatStartWait = Date.now();
    setLogs(prev => [...prev, `[${new Date().toLocaleTimeString()}] 📢 喊话模式，下次发送 ${nextWake.toFixed(0)} 秒后`]);

    const dragSafety = 5;
    const dragWindow = nextWake - dragSafety;
    if (dragWindow > 20 && Math.random() < 0.05) {
      const dragDelay = 5 + Math.random() * (dragWindow * 0.7);
      while (!loopStopped && (Date.now() - chatStartWait) < dragDelay * 1000) {
        await sleep(1);
      }
      if (!loopStopped && await acquireLock()) {
        try { await runTask('idle-drag'); }
        finally { releaseLock(); }
      }
    }
    const chatRemaining = nextWake - ((Date.now() - chatStartWait) / 1000);
    if (chatRemaining > 1) {
      const chatEndWait = Date.now();
      while (!loopStopped && (Date.now() - chatEndWait) < chatRemaining * 1000) {
        await sleep(1);
      }
    }
    if (loopStopped) break;

    if (await acquireLock()) {
      try {
        await runTask('send-world-chat', {
          message: features.worldChatMessage,
          isFirst: false
        });
      } finally { releaseLock(); }
    }
  }
  break;
}
```

**4c. UI 卡片（在自动探索卡片之后添加）：**

```tsx
{/* 自动喊话 */}
<div className={`flex flex-col gap-0 p-4 rounded-lg transition-colors border relative ${features.autoWorldChat ? 'border-purple-500 bg-purple-50' : 'border-slate-200 hover:border-slate-300'}`}>
  <div className="flex items-center justify-between">
    <span className="flex items-center gap-2 font-semibold text-sm text-slate-800"><span className="w-8 h-8 bg-purple-100 rounded-lg flex items-center justify-center text-base">📢</span>自动喊话</span>
    <label className="relative w-10 h-[22px] cursor-pointer flex-shrink-0">
      <input type="checkbox" checked={features.autoWorldChat}
        onChange={(e) => setFeatures({ ...features, autoWorldChat: e.target.checked })}
        className="sr-only" />
      <span className={`absolute inset-0 rounded-full transition-colors ${features.autoWorldChat ? 'bg-purple-500' : 'bg-slate-200'}`} />
      <span className={`absolute top-[2px] left-[2px] w-[18px] h-[18px] bg-white rounded-full transition-transform shadow-sm ${features.autoWorldChat ? 'translate-x-[18px]' : ''}`} />
    </label>
  </div>
  <div className="flex flex-col gap-2 mt-2">
    {features.autoWorldChat && <span className="text-xs px-1.5 py-0.5 bg-purple-500 text-white rounded-full font-medium w-fit">独立模式</span>}
    <div className="flex items-center gap-2">
      <span className="text-xs text-slate-400 whitespace-nowrap">消息内容</span>
      <input
        type="text"
        value={features.worldChatMessage}
        onChange={(e) => setFeatures({ ...features, worldChatMessage: e.target.value })}
        placeholder="输入喊话内容..."
        disabled={features.autoWorldChat}
        className="flex-1 px-2 py-1 bg-white border border-slate-200 rounded text-xs text-slate-700 focus:outline-none focus:border-purple-500 disabled:opacity-50"
      />
    </div>
    <div className="flex items-center gap-2">
      <span className="text-xs text-slate-400 whitespace-nowrap">间隔（秒）</span>
      <input
        type="number"
        value={features.worldChatInterval}
        onChange={(e) => setFeatures({ ...features, worldChatInterval: Number(e.target.value) })}
        disabled={features.autoWorldChat}
        min={60}
        className="w-20 px-2 py-1 bg-white border border-slate-200 rounded text-xs text-slate-700 focus:outline-none focus:border-purple-500 disabled:opacity-50"
      />
    </div>
  </div>
</div>
```

**4d. 互斥逻辑：** 在现有 explore 互斥检查基础上，为 worldChat 添加相同的互斥处理：
- 在"升级建筑"等卡片中，`disabled` 条件加 `|| features.autoWorldChat`
- 在最外层 div 的 className 中加 `features.autoWorldChat ? 'bg-slate-100 border-slate-200 opacity-70' : ...`

参照现有 explore 的 disabled/className 模式，在每个功能卡片上增加 `autoWorldChat` 禁用判断。

- [ ] **Commit**

```bash
git add web/src/pages/Home.tsx
git commit -m "feat: add auto world chat UI + loop with mutual exclusion"
```

---

### Task 5: 最终验证

- [ ] **Step 1: TypeScript 编译**

```bash
cd D:/SLG && npx tsc --noEmit
cd D:/SLG/web && npx tsc --noEmit
```

Expected: 无错误。

- [ ] **Step 2: 测试清单**

启动前后端后验证：
- [ ] 首页出现"自动喊话"卡片（紫色主题，与探索一致）
- [ ] 填入消息内容 + 设置间隔
- [ ] 开启喊话 → 其他功能卡片灰掉
- [ ] 点击开始 → 首次打开聊天面板，发送消息
- [ ] 后续按间隔 + 抖动循环发送
- [ ] 停止按钮可中断喊话循环
- [ ] 喊话模式下仍触发 idle-drag（低概率）
- [ ] 关闭喊话后其他功能恢复正常使用
