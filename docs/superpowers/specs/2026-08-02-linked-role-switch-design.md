# 连体号切号 设计

日期：2026-08-02（修订）

## 背景与目标

现有"账号调度"支持在多个配置方案（profile）之间自动轮换，下拉中的 4 种模式（按时间 / 按轮次 / 寨子 / 组合采集）控制的是**何时触发切号**；物理切号动作只有一种——游戏内"用户中心 → 切换账号"，OCR 匹配目标账号编号，切到**另一个游戏账号**。

新增"连体号"——切换到**同一个游戏账号下的另一个角色**（主号 ↔ 连体角色），物理点击路径与切账号不同。

关键设计：**"何时切"不变（仍由 4 种模式决定），"怎么切"由当前 profile 与目标 profile 的类型、编号共同决定。**

角色管理界面里两个角色的位置：
- **主号在左侧 (320,334)**
- **连体角色在右侧 (909,334)**

因此切连体时第 3 步点哪个坐标取决于切换方向：主号→连体点右侧 (909,334)；连体→主号点左侧 (320,334)。

## 切法决策表

| 当前 profile | 下一个 profile | 切法 |
|---|---|---|
| 主号（常规，编号 N） | 连体号（编号 N） | 连体流程，第 3 步点**右侧 (909,334)** |
| 连体号（编号 N） | 主号（常规，编号 N） | 连体流程，第 3 步点**左侧 (320,334)** |
| 其他跨账号情况（编号不同） | | 现有 OCR 切号 |

即：当且仅当"当前与下一编号相同、且至少一方是连体号"时走连体流程；其余走 OCR。连体号永远从主号切过去，也只切回同编号主号。连体号不能接连体号（UI 层规避，见下）。

## 数据模型

`plugins/rok/index.ts` 的 `RokConfig.accountSwitch` 增加 per-profile 字段：

```ts
accountSwitch: {
  accountName: string;                   // 账号编号。连体号也必须填，填主号相同的编号
  targetType: 'account' | 'linked';      // account=常规主号，linked=连体号；默认 'account'
}
```

默认值 `targetType: 'account'`。老配置缺字段按 `'account'` 处理，向后兼容，无需迁移。随 `accountSwitch` 一起落到 `~/.slg-automation/configs/<accountId>.json`，无需改 ConfigService。

## 配置页 UI（Config.tsx）

- 在"账号编号"输入框旁新增选择：**常规账号 / 连体号**，绑定 `accountSwitch.targetType`。
- **连体号也必须填账号编号**（填主号相同的编号），不禁用输入框。
- 随现有 `PUT /api/configs/...` 一起保存（与 `accountSwitch.accountName` 同路径）。

## 账号调度卡片（Home.tsx）

- 槽位下拉：选中连体号 profile 的槽位，在卡片头部显示紫色"连体"小角标，其余布局不变。
- **槽位 option 禁用规则**（环形槽位，槽 i 的邻居是 i-1 和 i+1；2 槽时首尾互邻）。某个 profile 在槽 i 被禁用，当满足任一：
  1. 已被其他槽位选中（现有规则）；
  2. 它是连体号，且相邻任一槽位已选连体号（**禁止连体接连体**）；
  3. 它是连体号，但当前所选槽位中没有与其**同编号的常规主号**（连体必须有主号配对）。
- option 文本：连体号 profile 显示"（连体）"后缀；没有账号编号的常规号仍显示"（未填编号）"并禁用。
- 卡片头部模式说明 tooltip 补一句连体号说明。
- 触发时机逻辑（`markRoundDone`、`scheduleSwitchTimer`、寨子兜底、组合采集分支）**完全不改**。

## 插件物理切号

### 抽出共享的"进城"逻辑

从 `plugins/rok/actions/switchAccount.ts` 的 `switchAccountOnce` 末尾把"点登录之后"（现有 140-165 行）抽成导出函数：

```ts
export async function waitForCityAfterLogin(ctx: PluginContext): Promise<'success' | 'switched_load_timeout'>
```

内容：等 15s → 随机点 `TAP_REGION` → 等 20s → 每 2s 轮询 `getCurrentLocation(ctx)==='city'` 最多 60s。常规切号改为调用它，行为不变。

### 新建连体号切号函数

新建 `plugins/rok/actions/switchLinkedRole.ts`：

```ts
export async function switchLinkedRole(ctx: PluginContext, direction: 'main-to-linked' | 'linked-to-main')
  : Promise<'success' | 'not_found' | 'switched_load_timeout'>
```

流程：

```
1. 点头像 (63,51) → sleep 0.5s
2. 点设置 (1358,743) → sleep 1s
3. 模板匹配 icon_role.png（阈值 0.75）：
   - 找到 → 点击角色按钮 → sleep 1s
   - 找不到 → 点 (1394,55) 关设置 → 点 (1454,88) 关玩家页 → 返回 'not_found'
4. 点"连体账号"：
   - direction='main-to-linked' → 点 (909,334)（右侧连体角色）
   - direction='linked-to-main' → 点 (320,334)（左侧主号）
   → sleep 1s
5. 对区域 (864,598)-(1168,680)（x=864,y=598,w=304,h=82）匹配 btn_surelogin.png（阈值 0.7）：
   - 匹配上 → 点击它
   - 匹配不上 → 点 (1366,105) 关角色管理 → 点 (1394,55) 关设置 → 点 (1454,88) 关玩家页 → 返回 'not_found'
6. 调 waitForCityAfterLogin(ctx) 并返回其结果
```

`findImageWithLocation` 第 6 个参数为搜索区域 `{ x, y, width, height }`（见 `core/plugin/PluginContext.ts:77-84`）。模板 `icon_role.png`、`btn_surelogin.png` 已存在于 `plugins/rok/templates/`。

### action 注册与决策（plugins/rok/index.ts）

`switch-account` action 的 params 扩展为：

```ts
{
  currentName: string;       // 当前 profile 的账号编号
  currentType: 'account' | 'linked';
  targetName: string;        // 目标 profile 的账号编号
  targetType: 'account' | 'linked';
}
```

action 内部按决策表判断：

```ts
const sameAccount = currentName.trim() === targetName.trim() && !!currentName.trim();
const isLinkedSwitch = sameAccount && (currentType === 'linked' || targetType === 'linked');
if (isLinkedSwitch) {
  const direction = currentType === 'account' && targetType === 'linked'
    ? 'main-to-linked'
    : 'linked-to-main';
  result = await switchLinkedRole(ctx, direction);
} else {
  result = await switchAccount(ctx, targetName);
}
ctx.log(`切换账号: ${result}`);
```

日志前缀保持 `切换账号: ...`，前端成功判定无需区分切法。

## 前端调度接线（Home.tsx accountSwitchLoop）

`accountSwitchLoop`（约 1243-1257 行）当前只读目标 profile 的 `accountName`。改为：

- 同时读取当前 profile 与目标 profile 的 `accountSwitch.accountName` 和 `targetType`（当前 profile 配置可从已加载的 active config 或再拉一次 getRokConfig 获得）。
- 目标是无编号的常规号 → 跳过该槽位（现有行为）。
- 创建 task 时传 `{ currentName, currentType, targetName, targetType }`。
- 成功判定不变（日志含 `切换账号: success` 或 `switched_load_timeout`）。
- 成功后仍走 `switchProfile` → 合并 features → reset cooldowns → 推进 `switchTargetIdx`，不变。

前端需要缓存每个 profile 的 `accountName`（已有 `profileAccountNames`）和 `targetType`（新增 `profileTargetTypes`），两处加载 profile 的地方一并填充。

## 错误处理

- 连体流程在"找不到角色按钮"或"找不到确认登录按钮"时，按顺序关闭对应弹窗回到城内，返回 `not_found`，避免弹窗残留影响后续任务。
- `not_found` 表现为切号失败，打印日志，不推进 profile。

## 测试

- `switchLinkedRole` 单元测试（mock PluginContext）覆盖：
  - `main-to-linked` 成功路径点了 (909,334)；
  - `linked-to-main` 成功路径点了 (320,334)；
  - 找不到 `icon_role` 返回 `not_found` 且点了关闭设置/玩家页；
  - 找不到 `btn_surelogin` 返回 `not_found` 且点了三个关闭按钮。
- action 决策逻辑：可通过抽一个纯函数 `resolveSwitchKind(...)` 返回 `'ocr' | { linked: direction }` 来做单元测试，覆盖决策表 4 种组合 + 编号不同走 OCR。
- 配置默认值：`targetType` 缺省为 `'account'`。

## 不在本次范围

- 不改动 4 种触发时机的任何逻辑。
- 不引入账号分组 / 一对多角色列表；一个连体号 profile 对应同账号下固定的另一个角色。
- 不改动 AccountService 的 `Account` 顶层模型（连体是 per-profile 概念）。
- 帮助站连体号说明段落另行更新，不在代码改动内。
