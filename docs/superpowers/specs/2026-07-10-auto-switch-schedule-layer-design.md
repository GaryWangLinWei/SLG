# 账号调度独立成层 — 设计文档

日期：2026-07-10
主题：把"自动切号"从功能卡片提升为跨账号调度层，独立成一块折叠横幅

## 背景

当前"自动切号"卡片和"自动采集宝石 / 自动攻打城寨 / 城外资源采集 / ..." 平铺在 `grid-cols-2` 中，语义不对等：

- 其他功能卡是**当前 profile 内部**的行为开关
- 自动切号是**跨 profile 的调度器**，控制"什么时候切到哪个 profile"

用户已确认："自动切号是全局设置，不该和其他功能同等级"。

## 目标

1. 视觉上把"账号调度"从功能卡区抽出，独立成层
2. 保留折叠机制，收起态紧凑，展开态跟随 v2 mockup 的横向 Profile 队列样式
3. 折叠状态跨会话记忆
4. 保留未来扩展多账号的入口（`+ 添加账号` 按钮，暂禁用）

## 非目标

- 不改后端 config schema
- 不改 `HomeFeatures` 字段
- 不做 3 个及以上账号的调度逻辑
- 不改切号本身的执行流程（switchAccount action / accountSwitchLoop 保持不变）

## 布局

```
[顶部状态栏]
[🔀 账号调度横幅]     ← 新增，全宽，跨越 grid 两列
[功能设置卡片区]      ← 保持现状（删除其中"自动切号"卡片）
```

### 横幅外观

- 容器：`bg-gradient-to-r from-amber-50 to-orange-50 border-2 border-amber-300 rounded-xl`
- 位置：状态栏下方、功能卡片区上方
- 全宽（不参与 grid），跨越整个内容区

### 折叠行为

- **收起态**：单行 `🔀 账号调度：开启/关闭 ▸`
  - 整行 clickable → 展开
  - 关闭/开启文字反映 `features.autoSwitchAccount`
  - 只保留最外层琥珀色边框，内部无内容
- **展开态**：显示完整头部 + Profile 队列 + 底部提示
  - 头部右上角 `▾` 按钮 → 收起
- **持久化**：`localStorage['accountScheduleExpanded']`，默认 `false`

## 展开态结构

### 头部（一行）

- 左：`🔀` 图标 + `账号调度` 标题 + 副标题（"控制何时切换到哪个配置方案 · 共 2 个账号"）
- 右：模式下拉（`按时间轮换 / 按轮次轮换 / 寨子模式`） + `调度` 开关 + `▾` 收起按钮

### Profile 队列

外层 `bg-white/70 rounded-lg p-3`，横向 flex 布局：

```
[Profile1] → [Profile2]  ↩ 循环   ...   [+ 添加账号（禁用）]
```

**账号 1 chip**（当前 active，只读）：
- 尺寸：`w-44 px-3 py-2.5 bg-white border-2 rounded-lg`
- 高亮：`border-emerald-500 bg-emerald-50 shadow -translate-y-0.5`
- 顶部：`● 当前` 绿色 tag + `#1` 灰色小序号
- 中间：`activeConfigName` 粗体（不可编辑）
- 底部（仅 `switchMode === 'per-time'` 时显示）：`<input type="number">` + `分钟`

**账号 2 chip**（可选，下拉）：
- 尺寸同上
- 样式：`border-slate-200 bg-white`
- 顶部：`● 待切换` 灰色 tag + `#2`
- 中间：`<select>`，选项 = `configNames.filter(p => p !== activeConfigName)`
- 底部（仅按时间模式）：时长输入 + `分钟`

**中间**：`→` 琥珀色箭头（`text-amber-500`）

**队列末尾**：`↩ 循环` 小字提示（`text-xs text-amber-500/70`）

**右端**：`+ 添加账号` 按钮，`disabled`，`opacity-50 cursor-not-allowed`，`title="暂不支持超过 2 个账号"`

### 底部提示

`💡 切号后自动加载对应方案的全部功能设置 · 共 2 个账号参与轮换`，琥珀色小字。

## 数据映射

| UI 元素 | features 字段 |
|---------|---------------|
| 调度开关 | `autoSwitchAccount` |
| 模式下拉 | `switchMode` |
| 账号 1 显示 | `activeConfigName`（非 features） |
| 账号 2 下拉 | `switchProfileIds[1]` |
| 账号 i 时长 | `switchIntervalMinutes[i]` |

**账号 1 同步**（已实现，保留）：
- `startLoop` 起点：把 `switchProfileIds[0]` 强制为 `activeConfigNameRef.current`
- 切号成功后：`preserveGlobalFields` merge 后再次同步 `switchProfileIds[0] = nextProfile`

**新增本地状态**：
- `const [accountScheduleExpanded, setAccountScheduleExpanded] = useState(...)`：初值从 `localStorage['accountScheduleExpanded']` 读取，默认 `false`
- setter 同步写 localStorage

## 交互

- 收起态点击整行：`setAccountScheduleExpanded(true)` + 写 localStorage
- 展开态 `▾` 按钮：`setAccountScheduleExpanded(false)` + 写 localStorage
- 模式下拉：切到非 `per-time` 时时长输入自动隐藏，`switchIntervalMinutes` 值保留
- 账号 2 下拉：写 `switchProfileIds[1]`；账号 1 位置继续由现有同步逻辑保证
- 时长输入：写 `switchIntervalMinutes[i]`，`Math.max(1, ...)` 兜底
- `+ 添加账号`：`disabled` + `title`，不绑 onClick

## 移除

删除现有 Home.tsx 中 `features.autoSwitchAccount` 的功能卡片块（约 2758–2831 行），迁移到新横幅位置。

## 测试

- 手动：
  1. 首次进入 → 收起态显示 `🔀 账号调度：关闭 ▸`
  2. 点击展开 → 显示完整头部 + 双 chip
  3. 刷新页面 → 展开状态保留
  4. 开启开关，切模式：`按时间` 时 chip 底部显示时长输入，其他模式隐藏
  5. 切换 profile 后，账号 1 chip 名称自动更新为新 active
  6. 账号 2 下拉不能选到与账号 1 相同的 profile

## 风险

- 无后端改动，风险局限在 UI
- 折叠状态 localStorage 与 features 不同源，不影响 loop 逻辑
