# 宝石采集（gatherGem）

## 概述

新增宝石采集功能，使用图像识别 + 螺旋搜索在世界地图上寻找宝石矿，派出勾选的队伍进行采集。流程组合了三个现有模块：`ensureInWorld`（城外重置）、螺旋搜索（从 rallyFort git 历史恢复）、`gatherResources` 后半段（队伍选择 + 行军）。

## 动机

- 宝石矿不在游戏内置搜索面板的资源类型中，必须用图像识别在世界地图上找
- rallyFort 原始版本的螺旋搜索 + 图像识别代码就是为此保留的
- 采集后半段（选队、检测空闲、行军）与 `gatherResources` 完全一致，直接复用

## 主流程

```
[1/7] 重置城外默认视角 — ensureInWorld()，已在城外时点2次切换重置摄像机
[2/7] 缩小地图 — pinch 双指捏合，扩大搜索视野（参数从 git 历史恢复）
[3/7] 螺旋搜索 baoshi.png — 最多 20 次
      - 截图 → findImageWithLocation(baoshi.png, 0.7, [0.7,0.8,0.9,1.0,1.1])
      - 找到 → 进入 [4/7]
      - 未找到 → 按螺旋方向滑动（右→下→左→上，臂长递增），继续搜索
      - 20 次后仍未找到 → 返回 { success: false, reason: 'not_found' }
[4/7] 点击宝石矿
      - 点击找到的宝石矿图标中心
      - sleep 1.5s 等待视角自动放大
      - 点击放大后的目标位置 (791, 423)
      - 截图搜索 btn_caiji.png 采集按钮
      - 点击采集按钮
[5/7] 检测空闲队伍 — AddTeamBtn 比对，无空闲→切换回城→停止所有后续队伍
[6/7] 选择队伍 — 分页检测 → checkButtonStateChange → 选中
[7/7] 点击行军 — 派出
```

## 多队伍执行逻辑

前端可勾选 1-5 个队伍（如勾选 1、3、4），action 按勾选的队伍列表依次执行：

- 每派出一队后，从 [1/7] 重新开始（含 pinch），搜索下一颗宝石矿
- 搜索 20 次未找到宝石矿 → 停止后续所有队伍
- 某个队伍无空闲（AddTeamBtn 匹配不到）→ 停止后续所有队伍
- 某个队伍不可用（checkButtonStateChange 无变化）→ 跳过当前队伍，继续下一个队伍

## 螺旋搜索参数（从 git 历史 3883738 恢复）

```typescript
SPIRAL_SWIPE_LENGTH = 600;       // 基础臂长
SEARCH_MAX_ATTEMPTS = 20;        // 搜索上限
SPIRAL_DIRECTIONS = [
  { dx: 1, dy: 0 },   // 右
  { dx: 0, dy: 1 },   // 下
  { dx: -1, dy: 0 },  // 左
  { dx: 0, dy: -1 },  // 上
];
// 滑动起点：屏幕中心 (540, 960)
// 臂长 = SPIRAL_SWIPE_LENGTH * (floor(attempt / 4) + 1)
```

## 文件改动清单

| 文件 | 改动 |
|------|------|
| `plugins/rok/actions/gatherGem.ts` | **新建** — 宝石采集完整流程 |
| `plugins/rok/index.ts` | RokConfig 新增 `gemGather` 段；注册 `gem-gather` action |
| `plugins/rok/homeFeatures.ts` | 新增 `gemGatherEnabled: boolean`、`gemGatherTeams: number[]` |
| `web/src/pages/Home.tsx` | 将"即将上线"占位替换为功能卡片（开关 + 5 队勾选） |
| `plugins/rok/templates/baoshi.png` | **新增** — 宝石矿地图图标模板（需用户截取提供） |

## 返回值

```typescript
interface GemGatherOutcome {
  result: 'success' | 'not_found' | 'no_idle_teams' | 'team_unavailable';
  dispatched: number;   // 派出的队伍总数
}
```

## 配置段

```typescript
gemGather: {
  baoshiTemplate: string;           // 'baoshi.png'
  caijiBtnTemplate: string;         // 'btn_caiji.png'
  pinchedGemTapPoint: { x: 791, y: 423 };
  pinch: {
    from1: { x: 300, y: 960 };
    from2: { x: 780, y: 960 };
    to1: { x: 500, y: 960 };
    to2: { x: 580, y: 960 };
    duration: 800;
  };
  searchMaxAttempts: 20;
  spiralSwipeLength: 600;
};
```

## 注意事项

- `baoshi.png` 模板需用户从游戏中截取宝石矿的地图图标（与 `ChengZhai.png` 类似）
- 放大后的点击坐标 `(791, 423)` 基于 1600×900 分辨率，与项目中其他硬编码坐标一致
- 螺旋搜索复用原始 rallyFort 的搜索算法，不做修改
- 每轮都完整执行 [1/7]~[2/7]（含 pinch），因为城内外切换不保证重置缩放
