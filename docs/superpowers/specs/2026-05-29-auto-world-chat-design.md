# 自动世界喊话 设计说明书

**日期:** 2026-05-29

---

## 概述

定时在世界频道发送用户自定义消息。开启后与其他 action 互斥（参照 autoExplore 模式）。

## 设计

### 操作流程

**首次运行：**
```
点击聊天区域 (418, 845) → 点击输入框 (601, 837) → adb input text 输入消息 → 点击发送 (1518, 848)
```
聊天面板保持打开。

**后续循环（聊天面板已打开）：**
```
点击输入框 (601, 837) → adb input text 输入消息 → 点击发送 (1518, 848)
```

### HomeFeatures 新增字段

```typescript
autoWorldChat: boolean;       // 开关
worldChatMessage: string;      // 消息内容，默认空
worldChatInterval: number;     // 间隔（秒），默认 300
```

### RokConfig 新增

```typescript
worldChat: {
  chatButton: { x: 418, y: 845 };
  inputBox: { x: 601, y: 837 };
  sendButton: { x: 1518, y: 848 };
}
```

### 间隔抖动

实际间隔 = `worldChatInterval * (0.85 + Math.random() * 0.3)`，与现有防检测模式一致。

### 互斥逻辑

与 autoExplore 完全一致：
- `autoWorldChat` 开启时 → 其他功能卡片灰掉 + disabled
- 其他功能开启时 → 开启 autoWorldChat 需要先关掉其他
- 主循环进入喊话专属模式，只跑喊话循环

## 涉及文件

| 文件 | 改动 |
|------|------|
| `plugins/rok/actions/sendWorldChat.ts` | 新建，喊话 action |
| `plugins/rok/index.ts` | 注册 action + RokConfig 新增 worldChat 坐标 |
| `plugins/rok/homeFeatures.ts` | 新增 autoWorldChat / worldChatMessage / worldChatInterval |
| `web/src/pages/Home.tsx` | 喊话功能卡片 + 独立循环 + 互斥 UI |

## 不涉及

- 后端改动
- 图像模板（坐标固定）
- 新依赖
