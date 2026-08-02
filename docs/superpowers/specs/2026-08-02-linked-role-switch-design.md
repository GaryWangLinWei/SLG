# 连体号切号 设计

日期：2026-08-02

## 背景与目标

现有"账号调度"支持在多个配置方案（profile）之间自动轮换，下拉中的 4 种模式（按时间 / 按轮次 / 寨子 / 组合采集）控制的是**何时触发切号**；而物理切号动作只有一种——通过游戏内"用户中心 → 切换账号"，OCR 匹配目标账号编号，切到**另一个游戏账号**。

新增需求："连体号"——切换到**同一个游戏账号下的另一个角色**。其物理点击路径与切账号完全不同。

关键设计决策：**"何时切"与"怎么切"是两个维度**。本次不改动 4 种触发时机，而是让"怎么切"由**目标 profile 自身的账号类型**决定：目标是常规账号走现有 OCR 切号，目标是连体号走新的角色切换流程。两种切法可在同一轮轮换中混用。

## 数据模型

在 `plugins/rok/index.ts` 的 `RokConfig.accountSwitch` 增加 per-profile 字段：

```ts
accountSwitch: {
  accountName: string;                   // 常规账号编号（OCR 匹配），连体号不使用
  targetType: 'account' | 'linked';      // 切到该 profile 时的物理切法，默认 'account'
}
```

默认值 `targetType: 'account'`。老配置缺该字段时按 `'account'` 处理，向后兼容，无需数据迁移。

该字段随 `homeFeatures` / `accountSwitch` 一起落到 `~/.slg-automation/configs/<accountId>.json`，无需改 ConfigService。

## 配置页 UI（Config.tsx）

- 在"账号编号"输入框旁新增选择：**常规账号 / 连体号**，绑定 `accountSwitch.targetType`。
- 选"连体号"时：账号编号输入框禁用并清空（连体流程不需要 OCR 编号）。
- 随现有 `PUT /api/configs/...` 一起保存，路径与 `accountSwitch.accountName` 一致。

## 账号调度卡片（Home.tsx）

- 槽位下拉：选中连体号 profile 的槽位，在 profile 名旁渲染一个"连体"小角标/标签，其余布局不变。
- 卡片头部模式说明 tooltip 补一句连体号的说明。
- 触发时机逻辑（`markRoundDone`、`scheduleSwitchTimer`、寨子 20 分钟兜底、组合采集分支）**完全不改**。

## 插件物理切号

### 抽出共享的"进城"逻辑

从 `plugins/rok/actions/switchAccount.ts` 的 `switchAccountOnce` 中，把"点登录之后"（现有 140-165 行）抽成共享函数：

```ts
export async function waitForCityAfterLogin(ctx: PluginContext): Promise<'success' | 'switched_load_timeout'>
```

内容：等 15s → 随机点 `TAP_REGION` → 等 20s → 每 2s 轮询 `getCurrentLocation(ctx)==='city'` 最多 60s。现有常规切号改为调用它，行为不变。

### 新建连体号切号 action

新建 `plugins/rok/actions/switchLinkedRole.ts`，实现：

```
1. 点头像 (63,51) → sleep 0.5s
2. 点设置 (1358,743) → sleep 1s
3. 模板匹配 icon_role.png（阈值 0.75）：
   - 找到 → 点击角色按钮 → sleep 1s
   - 找不到 → 点 (1394,55) 关设置 → 点 (1454,88) 关玩家页 → 返回 'not_found'
4. 点"连体账号" (909,334) → sleep 1s
5. 对区域 (864,598)-(1168,680)（即 x=864,y=598,w=304,h=82）匹配 btn_surelogin.png（阈值 0.7）：
   - 匹配上 → 点击它
   - 匹配不上 → 点 (1366,105) 关角色管理 → 点 (1394,55) 关设置 → 点 (1454,88) 关玩家页 → 返回 'not_found'
6. 调 waitForCityAfterLogin(ctx)，返回其结果（'success' 或 'switched_load_timeout'）
```

坐标以本设计列出的值为准（连体流程的头像/设置坐标与常规切号略有差异）。两个模板 `icon_role.png`、`btn_surelogin.png` 已存在于 `plugins/rok/templates/`。

返回类型沿用 `'success' | 'not_found' | 'switched_load_timeout'`。

### action 注册（plugins/rok/index.ts）

`switch-account` action 扩展 params，根据目标 profile 的 `targetType` 分支：

- `'account'`（默认）→ 调现有 `switchAccount(ctx, targetName)`
- `'linked'` → 调新 `switchLinkedRole(ctx)`

`ctx.log` 输出前缀保持 `切换账号: ...`，使前端成功判定无需区分切法。

## 前端调度接线（Home.tsx accountSwitchLoop）

`accountSwitchLoop`（约 1243-1257 行）当前只读目标 profile 的 `accountSwitch.accountName`。改为：

- 读取目标 profile 时同时取 `accountSwitch.targetType`（默认 `'account'`）。
- 创建 `switch-account` task 时按类型传参：
  - `account` → `{ targetName }`（空 accountName 仍跳过该槽位，维持现有行为）
  - `linked` → `{ targetType: 'linked' }`（不以 accountName 为空为由跳过）
- 成功判定不变（日志包含 `切换账号: success` 或 `切换账号: switched_load_timeout`）。
- 成功后仍走 `switchProfile` → 合并 features → reset cooldowns → 推进 `switchTargetIdx`，逻辑不变。

槽位渲染需要目标 profile 的 `targetType`，与现有读取 `profileAccountNames` 类似，一并拉取并存入一个 `Record<profileName, 'account'|'linked'>`。

## 错误处理

- 连体号流程在"找不到角色按钮"或"找不到确认登录按钮"时，按顺序关闭角色管理/设置/玩家页，回到正常城内界面后返回 `not_found`，避免弹窗残留影响后续任务。
- `not_found` 在前端表现为切号失败（与现有常规账号 `not_found` 一致），打印日志，不推进 profile。

## 测试

- `switchLinkedRole` 逻辑用 mock 的 `PluginContext` 写单元测试，覆盖：成功路径、找不到 icon_role 返回 not_found、找不到 btn_surelogin 返回 not_found。验证失败路径下三个关闭坐标都被点击。
- `homeFeatures` / 配置默认值测试：`targetType` 缺省为 `'account'`。
- 不主动运行全量测试，只跑与改动相关的测试文件。

## 不在本次范围

- 不改动 4 种触发时机的任何逻辑。
- 不引入账号分组 / 一对多角色列表；一个连体号 profile 对应一个固定的目标角色，切换动作为固定流程。
- 不改动 AccountService 的 `Account` 顶层模型（连体是 per-profile 概念，不跨设备）。
- 帮助站 `#qa-account-schedule-modes` 的连体号说明段落作为可选项，不在代码改动内（另行更新帮助页）。
