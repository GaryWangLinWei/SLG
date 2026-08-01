# 领取联盟领土收益 - 设计文档

- 日期：2026-08-01
- 状态：已确认（用户已批准设计，待写实施计划）

## 背景与目标

在万国觉醒自动化中新增"领取联盟领土收益"功能：定时打开联盟页面，进入领土页，点击领取按钮收取领土收益。用户已提供完整的操作坐标流程，本设计将其落为独立 action + 首页开关 + 4 小时 CD 子循环。

## 功能需求

首页"社交与辅助"卡片新增开关"领取联盟领土收益"，开启后每轮运行中每 4 小时执行一次以下流程：

1. 展开底部栏
2. 点击 `(1164, 835)` 打开联盟页面
3. 全屏识别 `icon_lingtu.png`（领土按钮）：
   - 识别到：点击按钮中心
   - 识别不到：点击 `(1392, 56)` 关闭联盟页面，结束本次 action
4. 点击领取按钮 `(1268, 173)`
5. 点击 `(1392, 56)` 关闭领土页面
6. 等待 0.5s
7. 点击 `(1392, 56)` 关闭联盟页面，结束

所有坐标基于 1600x900 分辨率设计。

## 设计

### 1. 新增 action

文件：`plugins/rok/actions/claimAllianceTerritory.ts`

- 导出 `claimAllianceTerritory(ctx: PluginContext): Promise<void>`
- 文件顶部定义命名常量（仿 `helpTeammates.ts`）：
  - `ALLIANCE_BUTTON = { x: 1164, y: 835 }`
  - `CLOSE_BUTTON = { x: 1392, y: 56 }`
  - `CLAIM_BUTTON = { x: 1268, y: 173 }`
  - `TERRITORY_TEMPLATE = 'icon_lingtu.png'`
- 步骤 1 复用 `ensureBottomBarState(ctx, 'expanded')`（来自 `plugins/rok/utils/location.ts`），检测失败不阻断，继续流程
- 步骤 3 使用 `ctx.findImageWithLocation(path.join(getTemplatesDir(), TERRITORY_TEMPLATE), 0.7)` 全屏匹配；匹配异常按未找到处理
- 每个点击后按流程加入等待：打开联盟页 1s、点击领土按钮后 1s、点击领取后 0.5s、关闭领土页后 0.5s、关闭联盟页后结束

### 2. 注册 action

`plugins/rok/index.ts` 中 `RiseOfKingdomsPlugin.actions` 增加：

```ts
{
  id: 'claim-alliance-territory',
  name: '领取联盟领土收益',
  description: '打开联盟领土页领取收益，每4小时执行',
  run: async (ctx) => {
    if (await ensureNoPopupBlocking(ctx, 'claim-alliance-territory')) return;
    await claimAllianceTerritory(ctx);
  }
}
```

### 3. 配置项

`plugins/rok/homeFeatures.ts`：

- `HomeFeatures` 增加 `claimAllianceTerritoryEnabled: boolean`
- `DEFAULT_HOME_FEATURES` 增加 `claimAllianceTerritoryEnabled: false`

旧配置缺失该字段时由配置合并逻辑用默认值兜底，无需额外兼容代码。

### 4. 前端调度（`web/src/pages/Home.tsx`）

1. "社交与辅助"卡片内新增开关，样式仿"自动帮助盟友"：
   - 图标 `🏴`，文案"领取联盟领土收益"，副文案"每4小时"
   - `checked={features.claimAllianceTerritoryEnabled}`，`disabled={features.autoWorldChat}`（与卡片内其他开关一致）
2. `hasAnyFeature` 起始校验中加入 `features.claimAllianceTerritoryEnabled`
3. `computeExpectedActions` 中加入 `if (f.claimAllianceTerritoryEnabled) exp.add('alliance-territory')`
4. 新增 `allianceTerritoryLoop` 子循环，结构完全仿照 `produceMaterialLoop`：
   - 首轮 `first` 跳过
   - `offlineActive` 时等待 30s
   - 开关未开启或 `autoWorldChat` 开启时等待 30s 继续
   - `acquireLock` → `ensureGameRunning` → `createTask(currentAccountId, 'com.rok.automation', 'claim-alliance-territory')` → `api.tasks.run`
   - 日志含"许可证已过期"时停止运行并弹提示（沿用现有机制）
   - 成功日志 `🏴 领取联盟领土收益 完成`，`markRoundDone('alliance-territory')`
   - CD 等待：`const intervalSec = 4 * 3600 * (0.85 + Math.random() * 0.3)`（3.4~4.6 小时），等待循环校验 `cooldownResetSeq`（切号打断重计时）
5. 将 `allianceTerritoryLoop` 加入 `Promise.all` 列表

## 错误处理

- 模板匹配异常视为未找到：关闭联盟页、安全结束
- 任务运行异常被 `catch {}` 吞掉（沿用 produceMaterialLoop），下一 CD 周期重试
- `ensureBottomBarState` 内部已 try/catch，失败不影响后续点击
- 许可证过期 → 停止循环并弹提示

## 测试与验证

- `npx tsc --noEmit` 类型检查通过
- 运行相关 Jest 测试（如 `homeFeatures.test.ts`）确认无回归
- action 本体依赖真实 ADB 截图链路，不写单元测试，与项目现有 action 测试策略一致

## 涉及文件

- 新增：`plugins/rok/actions/claimAllianceTerritory.ts`
- 修改：`plugins/rok/index.ts`
- 修改：`plugins/rok/homeFeatures.ts`
- 修改：`web/src/pages/Home.tsx`
