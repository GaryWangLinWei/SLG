# 城寨搜索重构：使用游戏内置搜索

## 概述

将 `rallyFort` action 从图像识别 + 螺旋搜索方案改为使用游戏内置的野蛮人城寨搜索面板，流程与 `gatherResources` 一致。原有的多模板匹配、螺旋搜索代码保留不动，留给后续宝石采集功能使用。

## 动机

- 游戏内置城寨搜索 UI 比图像识别更可靠，不受昼夜/天气光照影响
- 流程与 `gatherResources` 一致，维护成本低
- 无 OCR 依赖，无螺旋拖拽的不确定性

## 新流程

```
[1/7] 确保在城外 — ensureInWorld() 复用
[2/7] 打开搜索面板 — 点击搜索按钮 (78, 677)，sleep 1.5s
[3/7] 切换到城寨页签 — 点击 (438, 295)，sleep 1s
[4/7] 设置等级并搜索：
      - 快速点击 - ×9 重置到 1 级
      - 点击 + ×(targetLevel-1) 设到目标等级
      - 点击搜索按钮 (336, 593)
      - checkButtonStateChange 检测搜索结果
      - 降级逻辑：
        - 开启降级: 搜索失败则 -1 重试，降到 1 级仍无结果则切回城内
        - 未开启降级: 搜索失败 → 点击2次切换按钮（第1次退出搜索面板，第2次回到城内）
[5/7] 点击集结按钮 (1181, 615)，sleep 1.5s
[6/7] 确认集结时间 (1177, 396)，sleep 1s — 复用现有
[7/7] 选队 + 行军 — 复用现有（分页检测、checkButtonStateChange、行军按钮）
```

## 配置改动

### RokConfig 新增 `fortSearch` 段

```typescript
fortSearch: {
  searchButton: { x: 78, y: 677 };
  fortTab: { x: 438, y: 295 };
  minusButton: { x: 121, y: 484 };
  plusButton: { x: 559, y: 481 };
  searchActionButton: { x: 336, y: 593 };
  rallyButton: { x: 1181, y: 615 };
};
```

### HomeFeatures 新增 1 个字段

```typescript
rallyFortDowngrade: boolean;  // 默认 true
```

### 参数

不变：`{ level: number, team: number, downgrade?: boolean }`

### 返回值

不变：`RallyFortOutcome { result, dispatched, foundLevel? }`

## rallyFort.ts 改动明细

### 删除

- `FORT_TEMPLATES`、`JIJIE_TEMPLATE` — 不再需要图像识别
- `PINCH_START_SPREAD`、`PINCH_END_SPREAD`、`PINCH_DURATION` — 不再缩地图
- `SEARCH_MAX_ATTEMPTS`、`SPIRAL_SWIPE_LENGTH`、`SPIRAL_DIRECTIONS` — 不再螺旋搜索
- OCR 相关 import（`ocrService`）- 不再 OCR 识别等级

### 保留（复用）

- `SELECT_TEAM_BUTTON`、`TEAM_BUTTONS_NO_PAGE`、`TEAM_BUTTONS_PAGED`
- `MARCH_BUTTON`、`CLOSE_POPUP_BUTTON`、`CONFIRM_TIME_BUTTON`
- `PAGE_INDICATOR_TEMPLATE`

### 新增

- 从 `config.fortSearch` 读取搜索相关坐标
- 降级搜索逻辑（参考 `gatherResources` 的降级重试）

## 不删除的代码（留给宝石采集）

- `core/vision/Vision.ts` — `findAllImagesMultiTemplate` 方法
- `core/plugin/PluginContext.ts` — `findAllImagesMultiTemplate` 包装方法
- `plugins/rok/templates/ChengZhai*.png` — 三张城寨模板
- 螺旋搜索逻辑 — 后续宝石采集实现时从 git 历史恢复参考

## UI 改动

### Home.tsx 城寨卡片

新增一行降级搜索开关：

```
🏰 自动攻打城寨  [开关]
   目标等级: [下拉 1-10]
   队伍:     [下拉 1-5]
   降级搜索: [开关]         ← 新增
   循环间隔: [600] 秒
```

### rally-fort action 调用

task params 传 `{ level, team, downgrade }`，action 定义从 params 取 `downgrade` 传入 rallyFort。

## 涉及文件

| 文件 | 改动 |
|------|------|
| `plugins/rok/actions/rallyFort.ts` | 重写，用内置搜索替换图像识别+螺旋搜索 |
| `plugins/rok/index.ts` | RokConfig 新增 `fortSearch` 段；rally-fort action 传入 downgrade |
| `plugins/rok/homeFeatures.ts` | 新增 `rallyFortDowngrade` 字段 |
| `web/src/pages/Home.tsx` | 城寨卡片新增降级搜索开关；调用时传 downgrade |
