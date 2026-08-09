# 自动打野（attack-barbarian）设计

日期：2026-08-09

## 目标

新增独立功能"自动打野"：自动搜索并攻击野蛮人，第一次组队出兵，之后循环复用已驻扎的成型队伍连续攻击指定次数。等级 1-40，支持搜不到时在 ±2 级内自动换级搜索，支持体力不足使用药水。

## 前端卡片

新增独立卡片"自动打野"，三行布局：

- 第一行：野蛮人等级（输入框，1-40）+ 次数（输入框）。
- 第二行：派遣第（下拉 1-5）队伍 + 队伍页（下拉 蓝/红/黄）。
- 第三行：勾选框 + 体力不足使用药水。

## Action 接口

在 `plugins/rok/index.ts` 注册新 action，id `attack-barbarian`：

```ts
run(ctx, params: {
  level: number;        // 1-40，初始目标等级
  count: number;        // 总攻击次数（含第一次）
  team: number;         // 1-5
  teamPage: TeamPage;   // 'gather'蓝 | 'attack'红 | 'other'黄
  usePotion: boolean;   // 体力不足使用药水
})
```

文件：`plugins/rok/actions/attackBarbarian.ts`，导出 `attackBarbarian(ctx, config, params)`。

结果类型：

```ts
type AttackBarbarianResult =
  | 'success'            // 完成全部 count 次
  | 'not_found'          // ±2 级内全搜不到
  | 'no_attack_button'   // 找不到 btn_attack
  | 'no_biandui'         // 找不到编队按钮
  | 'team_unavailable'   // 选定队伍不可用
  | 'stamina_insufficient'
  | 'zhuzha_timeout';    // 5 分钟未等到驻扎
```

主流程：`for (let i = 0; i < count; i++)`，第 0 次走"首次攻击"分支，其余走"驻扎后再攻击"分支。任一失败立即返回对应结果并收尾回城。

入口前置：
- `ensureNoPopupBlocking` 检查弹窗遮挡。
- OCR 队伍计数预检（复用 rallyFort 的预备逻辑：截取 `(1507,169,55,31)`，`ocrService.readTeamCount`，`parseTeamCount` 解析，满队则直接返回）。

## 首次攻击流程（第 0 次）

1. **切到城外**：`ensureInWorld(ctx, config, { resetView: false })`。
2. **打开搜索面板**：点搜索入口 `(82,674)` → sleep 1.5；点野蛮人页签 `(148,294)` → sleep 1。
3. **设等级**：复用 rallyFort[5/8] 的 OCR 设级逻辑，适配野蛮人（最大等级 40）。抽内部函数 `setSearchLevel(ctx, targetLevel)`：
   - OCR 当前等级 → 按差值点 plus/minus（每次间隔 0.15s）；
   - OCR 失败 → 点重置按钮回 Lv.1 → 点 plus 到目标级；
   - 返回实际设置的等级。
   - 等级 OCR 区域、minus/plus rect、重置按钮沿用 rallyFort 的搜索面板坐标（同一面板布局；野蛮人等级区位置实现时按截图核对）。
4. **搜索 + ±2 级重试**：点搜索按钮 `(340,594)`，用 `checkButtonStateChangeRect` 判断是否搜到：
   - `changed` → 命中；
   - `!changed` → 按 **9→11→8→12**（目标 10 为例，先 ±1 再 ±2、交替上下）重设等级并重搜，等级钳制在 1~40；
   - 四个邻级全部 `!changed` → 点回城按钮，返回 `not_found`；
   - 命中后 sleep 2.5。
5. **点攻击**：全屏找 `btn_attack.png`（0.7）。找不到返回 `no_attack_button`；找到点击 → sleep 1.5。
6. **识别编队按钮**：复用 joinRally[5/6]——`findImageWithLocation(BTN_BIANDUI_TEMPLATE, 0.6)`，找不到等 2s 重试一次，仍无则关面板 `(1395,56)` + 回城 `(80,830)`，返回 `no_biandui`；找到点击。
7. **选队 + 行军（含体力/胜算）**：复用 joinRally[6/6]：
   - 检测分页 `btn_page_indicator.png`（0.8）；
   - 分页时 `ensureTeamPage(ctx, teamPage, 指示器坐标, 指示器区域)`；
   - 点选定队伍，`checkButtonStateChange` 确认选中，无变化返回 `team_unavailable`；
   - 点行军；
   - 处理胜算不足 `jijie/btn_surego.png` 二次确认；
   - 行动力不足时：领免费体力 → 读体力颜色 → green 重试行军；yellow 且 `usePotion=true` 则点药水按钮（最多 10 次）直到变绿；否则/用尽返回 `stamina_insufficient`。

## 驻扎后再攻击流程（第 1..count-1 次）

### 步骤 8 — 等待驻扎（每次攻击后都执行，含第 0 次）

- 点行军后，循环每 5s 一次用 `ctx.detectStateWithScreenshot(0.45, [3])`（class 3 = zhuzha）全屏检测，再过滤到右侧状态列最上方槽位区域。
- 命中条件：检测到的 zhuzha 中心点落在约 `(1530,220)–(1585,310)` 范围内（状态列最上面那个槽位；精确坐标实现时按现有 `STATUS_REGION` 与给定区域 `(1537,252)-(1575,299)` 核定）。
- 理由：自动打野期间打野队伍是最新派出的队伍，始终位于状态列最上方。
- 兜底：5 分钟（300s）仍未检测到 → 点回城，返回 `zhuzha_timeout`。
- 每轮检测轮询 `ctx.stopRequested`，保证可取消。

### 步骤 9 — 重搜野蛮人

- 点搜索入口 `(82,674)` 打开面板 → sleep 1.5。**不再点野蛮人页签**（依赖游戏保留上次页签）。
- 复用首次的"设级 + 搜索 + ±2 级重试"内部函数，目标等级沿用上一次成功攻击的等级。±2 级全搜不到 → 回城返回 `not_found`。
- 命中后 sleep 2.5，全屏找 `btn_attack.png` 点击；找不到返回 `no_attack_button`。

### 步骤 10 — 选中驻扎的队伍

- `ctx.detectStateWithScreenshot(0.45, [3])` 全屏检测 zhuzha，过滤到右侧大 UI 区域 `LARGE_REGION (1443,53,152,753)`，取 y 最小（最上方）的一个，按 `AVATAR_OFFSET{-25,-25}` 偏移点击其头像 → 选中已驻扎的成型队伍。

### 步骤 11 — 行军

- 在 `MARCH_SEARCH_REGION (1068,20,362,860)` 内找 `btn_xingjun.png`（0.7），点击 → sleep 1。
- 成型队伍直接开拔，不重走编队/选队，也不处理体力/胜算弹窗（体力在首次组队时已消耗）。
- 点击成功后回到步骤 8 等待下一次驻扎，直到完成 count 次。

## 收尾与错误处理

- 任何失败返回前：关闭可能打开的面板/弹窗（点 `config.backButton` 或关闭按钮），点回城按钮 `(82,814)` 切回城内，保证账号处于干净状态。
- 成功完成全部 count 次后同样点回城。
- 所有 sleep / 长循环使用 ctx 的可取消封装，响应停止。

## 体力 util 抽取

新建 `plugins/rok/utils/stamina.ts`，从 rallyFort.ts / joinRally.ts 抽出重复逻辑：

- 常量：`TILI_BUTTON_TEMPLATE`、`STAMINA_BAR_RECT`、`POTION_USE_BUTTON`、`CLOSE_STAMINA_POPUP`、`MAX_FREE_TILI_CLICKS=2`、`MAX_POTION_USES=10`；`TILI_BUTTON_REGION` 作为参数传入（两文件区域宽度不同）。
- 函数：
  - `readStaminaColor(ctx): Promise<'green'|'yellow'|'unknown'>`
  - `claimAllFreeStamina(ctx, region): Promise<void>`
  - `handleStaminaAfterMarch(ctx, usePotion, region): Promise<'ok'|'insufficient'>`
- rallyFort.ts、joinRally.ts 改为 import 这些函数，行为保持不变（机械重构，跑现有测试确认）。

## 测试

Jest + ts-jest，测试与源码同目录：

- ±2 级重试顺序生成器（纯函数）：
  - 目标 10 → `[9,11,8,12]`；
  - 边界钳制：目标 2 → `[1,3,4]`（去掉越界的 0）；目标 40 → `[39,38]`（去掉 41、42）；目标 1 → `[2,3]`。
- 体力颜色判定：把 RGB→颜色的纯判断抽成小函数，单测 green/yellow/unknown。
- ONNX / 点击部分依赖 ctx，不单测，靠手动验证。

## 前端改动

### homeFeatures.ts

新增字段及默认值：

```ts
autoAttackBarbarian: boolean;       // 默认 false
attackBarbarianLevel: number;       // 默认 5
attackBarbarianCount: number;       // 默认 5
attackBarbarianTeam: number;        // 默认 1
attackBarbarianTeamPage: TeamPageChoice; // 默认 'attack'
attackBarbarianUsePotion: boolean;  // 默认 false
```

### Home.tsx

- 新增 `attackBarbarianLoop`，参照 `rallyLoop` 结构：首轮 sleep、检查开关与参数、`acquireLock`/`ensureGameRunning`、`createTask(..., 'attack-barbarian', { level, count, team, teamPage, usePotion })`、`api.tasks.run`、按结果给 CD（体力不足长 CD）、`markRoundDone`。加入 `Promise.all` 并发列表。
- UI 卡片按三行布局，样式对齐现有卡片（攻打城寨卡片）；等级用 1-40 的输入框，次数输入框，队伍/队伍页 select，药水勾选框。
- 老配置缺字段时走默认值。

## 不做

- 不改动 rallyFort / joinRally 的行为（只做体力 util 的机械抽取）。
- 不做多队伍、不做战利品拾取、不做治疗/复活等后续逻辑。
- 不新增付费锁定（本期与攻打城寨同级，非 PRO 功能；若需锁定另行评估）。
