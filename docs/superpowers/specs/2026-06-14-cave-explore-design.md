# Cave Explore（山洞探索）设计规格

## 背景

万国觉醒中，斥候除了世界探索外，还有山洞探索功能。用户需求是自动化这一流程，并在首页"社交与辅助"卡片中以协作模式运行。

## 数据模型

### HomeFeatures 新增字段

```typescript
autoCaveExplore: boolean;  // 默认 false
```

### 内存级已探索列表

action 内部维护 `Set<string>`，key 为 `"X:130Y:1054"` OCR 解析格式。每次用户点击"开始运行"触发新一轮调用时天然清空（局部变量）。

## Action：caveExplore

文件：`plugins/rok/actions/caveExplore.ts`

### 流程图

```
第 0 步: resetCityView 重置城内视角
第 1 步: 拖动斥候营地到屏幕中心 → 点击 (800,450)
第 2 步: 图像识别弹出侦查按钮 pop_zhenChaBtn.png（复用 explore 的缓存 key "pop_ScoutBtn"）
第 3 步: 点击侦查按钮
第 4 步: 滑动斥候列表 (904,675) → (955,438)
第 5 步: 在 (509,385)-(566,797) 区域检测 chihou_idle.png 和 chihou_back.png
         → 都没找到：点击 (1365,109) 关闭界面，return
         → 找到了（idle 或 back）：统计个数，优先 tap idle 位置的斥候，进入第 6 步
第 6 步: 点击山洞页签 (940,267)
第 7 步: OCR 识别 3 个区域（见下方），解析山洞坐标 X/Y
         → 已在 explored set 中：跳过
         → 不在：点击该坐标区域中心，进入第 8 步
第 8 步: 点击调查按钮 (1141,596)
第 9 步: 图像识别 btn_explore.png → 点击派遣
第 10 步: 根据第 5 步统计的闲置总数 idleTotal 判断
         → idleTotal > 1：从第 0 步重新开始（下一轮第 5 步会重新扫描剩余斥候）
         → idleTotal == 1：点击 (1365,109) 关闭界面，return
```

### 第 5 步：闲置检测详解

- 搜索区域：`(509,385)` 到 `(566,797)`
- 模板：`chihou_idle.png`、`chihou_back.png`
- 使用 `findAllImages` 全量检测两个模板，收集所有匹配位置
- `idle` 和 `back` 均视为"闲置可用"
- 如果 `idle` 和 `back` 都有匹配，优先点击 `idle`
- 统计闲置总数，用于第 10 步判断是否需要重开

### 第 7 步：OCR 区域

| 区域 | 坐标范围 |
|------|---------|
| 区域 1 | (286,457) - (430,490) |
| 区域 2 | (286,611) - (430,644) |
| 区域 3 | (286,762) - (430,792) |

OCR 期望格式：`X:数字Y:数字`，解析出山洞坐标。判断是否在 `exploredSet` 中，不在则点击并继续。

### 返回值

```typescript
type CaveExploreResult = 'success' | 'no_scout_button' | 'no_idle_scout';
```

## 配置依赖

- 需要 `config.buildingPositions['斥候营地']`（与 autoExplore 共用同一个 building）
- 如果没有标记斥候营地坐标，action 返回 `'no_scout_button'`

## 模板依赖

| 模板文件 | 用途 | 备注 |
|---------|------|------|
| `pop_zhenChaBtn.png` | 弹出侦查按钮 | 复用 explore 的模板和缓存 key |
| `chihou_idle.png` | 闲置斥候 | 新增 |
| `chihou_back.png` | 归巢斥候 | 新增 |
| `btn_explore.png` | 派遣按钮 | 复用 explore 的模板 |

## Home.tsx 集成

### UI

- 位置：社交与辅助卡片内，新增一行
- 图标：🏔️
- 开关：`autoCaveExplore`
- 指示：开启后显示绿色边框
- 协作模式，不设为独立模式（不暂停其他功能）

### 主循环调度

```typescript
// 山洞探索：每 5 分钟执行一轮
if (features.autoCaveExplore && !features.autoExplore && !features.autoWorldChat) {
  const now = Date.now();
  if (!lastCaveExploreTime || (now - lastCaveExploreTime) >= 5 * 60 * 1000) {
    if (!buildingOptions.includes('斥候营地')) {
      // log 警告
    } else if (await acquireLock()) {
      try { await runTask('cave-explore'); }
      finally { releaseLock(); }
    }
    lastCaveExploreTime = now;
  }
}
```

## 注册

`plugins/rok/index.ts`：新增 `caveExplore` import 和 `cave-explore` action 注册。
