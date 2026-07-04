# 宝石采集混合模式设计

## 背景

近期出现用户因宝石采集被系统判定为"使用第三方软件"导致资源扣除。宝石采集的高危特征之一是**行为单一**：用户要么全程普通模式（螺旋滑动 + 采集），要么全程专注模式（驻扎），一整段采集期动作序列高度可预测。

引入**混合模式**：一次 active 采集期内随机交替使用普通/专注两种模式，打散动作模式，降低被识别为脚本的概率。

## 目标

- 用户可选择"普通 / 专注 / 混合"三种模式
- 混合模式下每一轮采集独立随机选择本轮用哪种模式
- 保留原有普通/专注两种模式的完整行为，混合模式仅在调度层实现

## 非目标

- 不修改 `gatherGem.ts` / `gatherGemFocus.ts` action 内部逻辑
- 不引入服务器端配置
- 不引入自动回兵/其他反检测手段（另有 spec）

## 需求

### 用户可配置

- `gemGatherMode: 'normal' | 'focus' | 'mixed'`（默认 `'normal'`）—— 替换现有的 `gemGatherFocusMode: boolean`
- UI：宝石采集卡片内三选一单选（普通 / 专注 / 混合）

### 混合模式行为

- **每次进入 active 阶段**：随机生成本期专注占比 `focusRatio ∈ [0.3, 0.7]`
- **每一轮采集**：`Math.random() < focusRatio` → 本轮走专注（`gem-gather-focus`），否则走普通（`gem-gather`）
- **每轮间隔**：按本轮实际使用的模式取，专注 60s / 普通 300s（保留现有 ±15% 抖动）
- **日志**：
  - active 开始：`💎 混合采集开始，本期专注占比 47%，持续 2h`
  - 每轮结束：`💎 宝石采集(专注)完成` / `💎 宝石采集(普通)完成`

### 兼容迁移

读取 localStorage 中旧字段时：

- `gemGatherFocusMode === true` → `gemGatherMode = 'focus'`
- 否则 → `gemGatherMode = 'normal'`

写回时只写 `gemGatherMode`，旧字段自然废弃。

### 独占运行

原判断 `!(features.gemGatherEnabled && features.gemGatherFocusMode)` 用于让专注模式独占主循环。改造后：

- `gemGatherMode === 'focus'` → 独占（不跑建筑/科技/训练等）
- `gemGatherMode === 'mixed'` 或 `'normal'` → 不独占，允许并行其他功能

## 架构

### 数据流

```
Home.tsx 宝石独立循环
  ├─ 进入 active 阶段
  │    if mode === 'mixed':
  │       focusRatio = 0.3 + Math.random() * 0.4
  │    log active 开始
  ├─ 每轮采集前
  │    isFocus = (mode === 'mixed') ? Math.random() < focusRatio
  │              : mode === 'focus'
  │    actionId = isFocus ? 'gem-gather-focus' : 'gem-gather'
  │    intervalSec = isFocus ? 60 : 300
  ├─ runTask(actionId)
  └─ 等 intervalSec × (0.85 ~ 1.15)，回到轮采集
```

### 修改文件

- `plugins/rok/homeFeatures.ts` —— 字段替换 + 默认值 + 从旧字段迁移
- `web/src/pages/Home.tsx` —— UI 三选一 + 独立循环调度调整 + `hasMainWork` 判断改用新字段

### 不改文件

- `plugins/rok/actions/gatherGem.ts`
- `plugins/rok/actions/gatherGemFocus.ts`

## 关键约束

- `focusRatio` 只在 active 阶段起点掷一次，整个 active 期沿用
- 每轮独立随机（不做"最少 N 轮/最多 N 轮"限制），避免混合仍出现明显模式
- rest 阶段行为不变

## 测试

- 选普通 → 与改造前一致
- 选专注 → 与改造前一致，独占主循环
- 选混合 → active 开始日志出现"本期专注占比 X%"，多轮采集日志能看到两种模式交替
- 老用户 `gemGatherFocusMode: true` → 升级后为 `'focus'`
- 老用户 `gemGatherFocusMode: false` 或未设置 → 升级后为 `'normal'`

## 涉及文件

| 用途 | 路径 |
|------|------|
| 功能开关字段 + 迁移 | `plugins/rok/homeFeatures.ts` |
| UI + 调度 | `web/src/pages/Home.tsx` |
