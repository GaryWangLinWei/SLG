# 采集分享矿 设计文档

日期：2026-07-17

## 背景

`shareGem` 已实现「本号搜矿并分享给主号」的流程。现在补齐反向流程：**小号从聊天里读主号分享的宝石矿坐标，直接采集**。

典型场景：
- A 号（主号）：勾「分享宝石矿」 → 螺旋搜矿 → 分享到主号
- B 号（小号）：勾「采集分享矿」 → 从聊天里读主号消息 → 出队 → 采
- B 号列表空 → 本轮跳过 → 账号调度切到 A 号搜矿分享 → 下轮切回 B 号继续采

## 数据模型

### `plugins/rok/state/sharedGemPool.ts`（新建）

按账号隔离的坐标池。生命周期：从「开始运行」按下一刻起，到下次「开始运行」清空。停止运行不清。

```ts
export interface SharedGemCoord { x: number; y: number; }

class SharedGemPool {
  private byAccount = new Map<string, SharedGemCoord[]>();
  size(accountId: string): number;
  pop(accountId: string): SharedGemCoord | undefined;
  addUnique(accountId: string, c: SharedGemCoord): boolean;
  has(accountId: string, c: SharedGemCoord): boolean;
  clearAll(): void;
  clear(accountId: string): void;
}
export const sharedGemPool = new SharedGemPool();
```

去重键：`${x},${y}` 字符串。`addUnique` 返回是否新加入。

## Action 列表

### 1. `collect-shared-gem-coords`（新建 action，独立可调试）

`plugins/rok/actions/collectSharedGemCoords.ts`

参数：`{ accountId: string }`

流程：

1. 点击 `(375, 854)` 打开聊天框，sleep 1s
2. 检查是否已展开：`captureRegion(508, 5, 64, 58)` → 找 `zhankai_blue.png` 或 `zhankai_zong.png`。任一命中即已展开，否则点击 `(45, 34)` 展开，sleep
3. 在区域 `(20, 66, 91, 754)` 找 `mainrolehead.png`。
   - 未找到：点击 `(1189, 447)` 关闭聊天，`return { result: 'no_mainrole', collected: 0 }`
   - 找到：点击该头像位置，sleep 1s
4. 收集循环（最多 15 屏保险）：
   - `findAllImages(pin_gem.png, 0.75, searchRegion=聊天区)` 找所有蓝色定位 pin
   - 对每个 pin 位置 `(px, py)`：`captureRegion(px - 215, py - 12, 200, 55)` 拿到含 `X:xxxx Y:yyy` 的小块 → `ocrService.readText`（英文数字模式，可正确读 `X:1135 Y:875`）
   - 正则：`/X[:：]\s*(\d+)\s*Y[:：]\s*(\d+)/` 提取坐标
   - 逐个 `sharedGemPool.addUnique(accountId, c)`；同时收集本屏坐标集 `pageCoords`
   - 判定停止（策略 A）：`pageCoords.length > 0 && pageCoords.every(c => sharedGemPool.has(accountId, c) && !addedThisPage.has(c))` —— 本屏所有坐标都是"已经存在于池中且本屏没新加"→ break
   - 否则 swipe `(641, 121) → (618, 720)`，sleep 0.8s
5. 点击 `(1189, 447)` 关闭聊天
6. `return { result: 'ok' | 'ocr_empty', collected, poolSize }`

**OCR 策略确认**：不整块 OCR 聊天区。**只对每个 pin 图标左侧的小块单独 OCR**，精度高、速度快。

**为什么过滤宝石矿床不用文字**：`pin_gem.png` 是宝石矿床专属的蓝色 pin（图标形状/颜色和农田等其他资源类型不同），模板匹配本身就是过滤。如果实测发现农田等类型的 pin 与之相似，再加一层"OCR 文本必须包含'宝石矿床'"过滤。

### 2. `gather-shared-gem`（新建 action）

`plugins/rok/actions/gatherSharedGem.ts`

参数：`{ accountId: string }`（其他复用 `RokConfig`）

流程：

1. `ensureInWorld(ctx, config)`
2. 若 `sharedGemPool.size(accountId) < 5`：**内联调用** `collectSharedGemCoords`（不通过 action registry，直接 import 函数），就地扩充池
3. 若 `sharedGemPool.size(accountId) === 0`：`return { result: 'empty', gathered: 0 }` —— 主循环拿这个信号知道该切号
4. 采集循环：
   - `const coord = sharedGemPool.pop(accountId)`；无则 break
   - `locateByCoord(ctx, coord.x, coord.y)`（**从 shareGem.ts 抽到 `utils/locateCoord.ts`**）
   - `await ctx.sleep(2)`
   - `dispatchToSharedGem(ctx, config)` —— 从 `gatherGem.ts` 抽出的公共派兵函数，负责点击宝石图标 → 弹派遣面板 → 选队伍 → 派出。返回 `{ dispatched, noIdleTeam }`
   - 若 `noIdleTeam` → break（当前号采不动了，等下轮）
   - 若 `dispatched` → `gathered++`
5. `return { result: 'ok' | 'no_team', gathered }`

**策略 A（一次消耗）**：`pop` 立即出队，无论后续成功失败都不再用。

### 3. 修改 `share-gem` action

不改流程，只改依赖：`locateByCoord` 和 `typeDigitsLikeHuman` 从 `utils/locateCoord.ts` 导入。

### 4. 修改 `gem-gather` action

从 `gatherGem.ts` 抽出 `dispatchToSharedGem`：接收「已经定位到宝石矿附近视角」的截图，负责点击宝石 → 弹派兵 → 选空闲队伍 → 派出。gatherGem 原有 `searchAndClickGem + dispatchToTeamPopup` 中的派兵段落改为调用这个新函数。

### 5. `clear-shared-gem-pool`（新建 action）

`plugins/rok/actions/clearSharedGemPool.ts`

参数：无。作用：`sharedGemPool.clearAll()`。前端在「开始运行」按下时调用一次。

## Home.tsx 主循环改动

**gemLoop 分支**：

```ts
const useShared = features.gemGatherEnabled 
  && features.gemGatherSharedOnly 
  && !isFeatureLocked('gemGather');

const actionId = useShared ? 'gather-shared-gem' : 'gem-gather';
const result = await runAction(actionId, { accountId: currentAccountId });

// useShared 且 result.result === 'empty'：不额外处理，让 accountSwitchLoop 自然轮转
```

**开始运行时清池**：`start()` 函数入口调一次 `runAction('clear-shared-gem-pool')`。

**账号切换互动**：`sharedGemPool` 按 accountId 隔离，切号后 B 号看到的仍是自己上次留下的池；每次进 `gather-shared-gem` 都会先看是否 <5 触发一次收集，所以切回来时会自动读到 A 号刚分享的新坐标。

## UI 改动

`web/src/pages/Home.tsx` 采集宝石卡片的高级策略里，把「采集分享矿」chip 从禁用改成正常可勾选：

- 去掉 `opacity-50 pointer-events-none` 和 `暂未开放` 文字
- `checked = features.gemGatherSharedOnly`，`onChange` 写入 setFeatures
- `disabled = !features.gemGatherEnabled || isFeatureLocked('gemGather')`
- 使用 `home-card-checkbox-style` memory 里记录的 sr-only + peer + 自绘方框样式

Pro 权限沿用 `gemGather` 的锁（`PRO_FEATURES` 已含 `gemGather`）。

## 新增模板

`plugins/rok/templates/share_gem/`：

| 文件 | 用途 |
|------|------|
| `zhankai_blue.png` | 用户提供 — 聊天列表已展开状态（蓝色版本） |
| `zhankai_zong.png` | 用户提供 — 聊天列表已展开状态（棕色版本） |
| `pin_gem.png` | 已提供 — 宝石矿床蓝色定位 pin 图标 |
| `mainrolehead.png` | 已存在 — 主号头像 |

## 关键坐标（1600×900）

| 名称 | 坐标 |
|------|------|
| 聊天入口 | `(375, 854)` |
| 展开检测区 | `(508, 5) - (571, 62)` = `x=508, y=5, w=64, h=58` |
| 展开按钮 | `(45, 34)` |
| 主号头像搜索区 | `(20, 66) - (110, 819)` = `x=20, y=66, w=91, h=754` |
| 关闭聊天 | `(1189, 447)` |
| 滑动起点 | `(641, 121)` |
| 滑动终点 | `(618, 720)` |
| 坐标输入入口 | `(552, 26)`（已存在于 shareGem） |
| X 输入框 | `(799, 176)` |
| Y 输入框 | `(987, 178)` |
| 坐标搜索按钮 | `(1108, 180)` |

## 错误处理

| 场景 | 处理 |
|------|------|
| `collectSharedGemCoords` 找不到主号头像 | 关闭聊天，`result: 'no_mainrole'`，不算错 |
| OCR 读不出坐标 | 该 pin 跳过，继续下一个 |
| 一屏 OCR 一个都没抓到 | 继续滑，直到 15 屏上限 |
| pool 为空 | `gather-shared-gem` 返回 `'empty'`，主循环跳过本轮 |
| `dispatchToSharedGem` 无空闲队伍 | 停止本轮采集，返回 `'no_team'` |
| 采集过程中 stopRequested | PluginContext 的 checkStop 自动中断 |

## 测试思路

- **单元测**：`sharedGemPool` 的 addUnique/pop/has/clear 逻辑
- **单元测**：坐标解析正则对若干 OCR 文本样本
- **手工测**：
  - 打开聊天、找到主号消息、看是否正确 OCR 出若干坐标
  - 切号后 pool 是否独立
  - 「开始运行」是否清 pool

## 文件清单

**新建**：
- `plugins/rok/state/sharedGemPool.ts`
- `plugins/rok/actions/collectSharedGemCoords.ts`
- `plugins/rok/actions/gatherSharedGem.ts`
- `plugins/rok/actions/clearSharedGemPool.ts`
- `plugins/rok/utils/locateCoord.ts`
- `plugins/rok/templates/share_gem/zhankai_blue.png`（用户提供）
- `plugins/rok/templates/share_gem/zhankai_zong.png`（用户提供）

**修改**：
- `plugins/rok/actions/shareGem.ts` — 依赖 `utils/locateCoord.ts`
- `plugins/rok/actions/gatherGem.ts` — 抽出 `dispatchToSharedGem`
- `plugins/rok/index.ts` — 注册 3 个新 action
- `web/src/pages/Home.tsx` — 采集分享矿勾选框启用；gemLoop 分支；start 清 pool

## Out of scope

- 坐标等级筛选（1/2/3/4 级分享矿都采）—— 暂不做筛选，全采
- 时效性（分享矿可能过期）—— 由消耗策略 A（一次性）+ 定位失败退回队伍自动兜底
- 池持久化 —— 明确内存
- 跨账号共享 pool —— 明确不共享
