# 联盟科技捐献 + 联盟功能卡片 - 设计文档

- 日期：2026-08-04
- 状态：已确认（用户已批准设计，待写实施计划）

## 背景与目标

新增"联盟科技捐献"功能：定时打开联盟 → 科技界面，识别"推荐"科技，进入捐献弹窗，读取剩余可捐献次数 `N/20`，按 N 次点击捐献按钮。同时将首页的"自动帮助盟友"和"领取联盟领土收益"从原"社交与辅助"卡片迁出，与新功能合并为一个新的"联盟功能"卡片。用户已提供完整操作坐标流程和两张模板图。

模板素材（已由用户提供）：

- `plugins/rok/templates/lianmeng/icon_tuijian.png`
- `plugins/rok/templates/lianmeng/btn_juanxian.png`

所有坐标基于 1600×900 分辨率设计。

## 功能需求

新增开关"联盟科技捐献"，默认关闭。开启后每 4 小时（带随机抖动）执行一次：

1. 展开底部栏
2. 点击 `(1165, 838)` 打开联盟界面
3. 点击 `(879, 689)` 打开联盟科技界面
4. 全屏识别 `icon_tuijian.png`（推荐图标），阈值 0.7：
   - 识别不到：点击 `(1394, 91)` 关闭科技界面、点击 `(1394, 55)` 关闭联盟界面，结束 action
   - 识别到：继续
5. 点击推荐图标中心 + `(50, 50)` 偏移位置，进入推荐科技捐献界面
6. 在区域 `(1107, 663)`–`(1340, 721)`（即 `{x:1107, y:663, width:233, height:58}`）内匹配 `btn_juanxian.png`，阈值 0.7：
   - 匹配不到：点击 `(1363, 103)` 关闭捐献弹窗、点击 `(1394, 91)` 关闭科技界面、点击 `(1394, 55)` 关闭联盟界面，结束 action，日志"找不到捐献按钮"
   - 匹配到：记录按钮中心坐标，继续
7. OCR 区域 `(1240, 636)`–`(1302, 666)`（即 `{x:1240, y:636, width:62, height:30}`），格式 `N/20`，取 `/` 前的 N（0–20）为可捐献次数：
   - OCR 失败或解析不到：兜底点击 10 次，记 `⚠️` 日志
8. 按次数循环点击第 6 步识别到的捐献按钮，每次间隔 0.5s；点击结束后依次关闭：捐献弹窗 `(1363, 103)` → 科技界面 `(1394, 91)` → 联盟界面 `(1394, 55)`，action 结束。N=0 时不点击，直接关闭。

## 设计

### 1. 新增 action

文件：`plugins/rok/actions/donateAllianceTech.ts`

- 导出 `donateAllianceTech(ctx: PluginContext): Promise<void>`
- 文件顶部定义命名常量（仿 `claimAllianceTerritory.ts` 风格）：
  - `ALLIANCE_BUTTON = { x: 1165, y: 838 }`
  - `TECH_BUTTON = { x: 879, y: 689 }`
  - `TUIJIAN_OFFSET = { dx: 50, dy: 50 }`
  - `CLOSE_DONATE = { x: 1363, y: 103 }`
  - `CLOSE_TECH = { x: 1394, y: 91 }`
  - `CLOSE_ALLIANCE = { x: 1394, y: 55 }`
  - `JUANXIAN_REGION = { x: 1107, y: 663, width: 233, height: 58 }`
  - `COUNT_REGION = { x: 1240, y: 636, width: 62, height: 30 }`
  - 模板路径 `path.join(getTemplatesDir(), 'lianmeng/icon_tuijian.png')`、`.../lianmeng/btn_juanxian.png`
  - 阈值 `THRESHOLD = 0.7`
- 步骤 1 复用 `ensureBottomBarState(ctx, 'expanded')`（来自 `plugins/rok/utils/location.ts`），检测失败不阻断
- 步骤 4 使用 `ctx.findImageWithLocation(iconTuijian, 0.7)` 全屏匹配
- 步骤 6 使用 `ctx.findImageWithLocation(btnJuanxian, 0.7, undefined, undefined, undefined, JUANXIAN_REGION)` 区域匹配，返回坐标即按钮中心，供步骤 8 复用
- 步骤 7 使用 `ctx.captureRegion(...)` 得到临时 PNG → `ocrService.readTeamCount(path)`（白名单 `0123456789/`，正是 N/M 格式）→ `parseDonateCount(text)` 解析；临时 PNG 在 `finally` 中 `fs.unlink`
- 抽本地辅助函数 `closeAll()` 统一关闭三层（捐献弹窗→科技→联盟），步骤 6 的异常退出和步骤 8 的正常退出都调用它，避免漏关
- 步骤 4 的"无推荐科技"只关两层（科技 + 联盟），单独处理（未进入捐献弹窗）
- 等待时长：打开联盟 1.5s、点科技 1.5s、进捐献弹窗 1.5s、每次捐献点击 0.5s、各关闭动作 0.3–0.5s

### 2. 纯函数 parseDonateCount

同文件导出（供测试）：

```ts
export const DONATE_FALLBACK_CLICKS = 10;
/**
 * 从 OCR 文本（如 "17/20"）解析可捐献次数。
 * @returns 0–20 的整数；无法解析返回 -1，表示调用方应使用兜底点击次数。
 */
export function parseDonateCount(text: string): number;
```

规则：

- 取第一个 `/` 前的数字；无 `/` 时尝试取首个整数
- parseInt 失败或 NaN → -1
- clamp 到 [0, 20]（OCR 偶发把 1 识别成 7 等，超界按边界处理）
- `"0/20"` → 0；`"17/20"` → 17；`" /20"`、`""`、`"abc"` → -1

### 3. 注册 action

`plugins/rok/index.ts`：

- import `donateAllianceTech`
- 在 `claim-alliance-territory` 之后注册：

```ts
{
  id: 'donate-alliance-tech',
  name: '联盟科技捐献',
  description: '打开联盟科技，按推荐科技捐献剩余次数，每4小时执行',
  run: async (ctx) => {
    if (await ensureNoPopupBlocking(ctx, 'donate-alliance-tech')) return;
    await donateAllianceTech(ctx);
  }
}
```

### 4. 配置项

`plugins/rok/homeFeatures.ts`：

- `HomeFeatures` 增加 `donateAllianceTechEnabled: boolean`
- `DEFAULT_HOME_FEATURES` 增加 `donateAllianceTechEnabled: false`

旧配置缺字段由配置合并逻辑用默认值兜底，无需额外兼容代码。

### 5. 前端卡片（`web/src/pages/Home.tsx`）

新建"联盟功能"卡片，从现有"社交与辅助"卡片**迁出**以下两项并新增一项：

- 🤝 自动帮助盟友（`helpTeammates`）
- 🚩 领取联盟领土收益（`claimAllianceTerritoryEnabled`）
- 🔬 联盟科技捐献（`donateAllianceTechEnabled`，新增）

自动开盾及其它项保留在"社交与辅助"卡片。新卡片容器与标题样式沿用现有卡片（`flex flex-col gap-0 p-4 rounded-lg ... border`），图标建议 🏛️ 或 🔬，标题"联盟功能"。三个开关均使用现有 toggle 样式，并在 `features.autoWorldChat` 时禁用。

### 6. 前端调度（`web/src/pages/Home.tsx`）

1. `hasAnyFeature` 起始校验加入 `features.donateAllianceTechEnabled`
2. `computeExpectedActions` 加入 `if (f.donateAllianceTechEnabled) exp.add('alliance-tech')`
3. 新增 `allianceTechLoop` 子循环，结构仿照 `allianceTerritoryLoop`（Home.tsx:1786）：
   - 首轮 `first` 跳过
   - `offlineActive` 时等 30s
   - 开关关闭或 `autoWorldChat` 开启时等 30s 继续
   - `acquireLock` → `ensureGameRunning` → `createTask(currentAccountId, 'com.rok.automation', 'donate-alliance-tech')` → `api.tasks.run`
   - 日志含"许可证已过期"时停止运行并弹提示
   - 成功日志 `🔬 联盟科技捐献 完成`，`markRoundDone('alliance-tech')`
   - CD：`const intervalSec = 4 * 3600 * (0.85 + Math.random() * 0.3)`（3.4~4.6 小时），等待循环校验 `cooldownResetSeq`（切号打断重计时）
4. 将 `allianceTechLoop` 加入 `Promise.all` 列表

联盟类任务完成只标记本轮动作，不触发立即切号，故与其他循环的启动先后无特殊要求。

## 错误处理

- 模板匹配异常或未命中：按对应层级安全关闭弹窗并结束 action，不抛异常
- 步骤 6 匹配不到捐献按钮：关三层，日志"找不到捐献按钮"，返回
- OCR 失败/解析失败：兜底点击 10 次并打 `⚠️` 日志，不阻断
- N=0：不点击，直接关闭
- 关闭顺序固定：捐献弹窗 `(1363,103)` → 科技 `(1394,91)` → 联盟 `(1394,55)`；由 `closeAll()` 复用
- `captureRegion` 临时文件在 `finally` 中 `fs.unlink`（删除失败忽略）
- action 不抛错；Home 子循环外层 `catch {}` 吞异常，下一 CD 周期重试
- 许可证过期 → 停止循环并弹提示（沿用现有机制）

## 测试与验证

- 新增 `plugins/rok/actions/donateAllianceTech.test.ts`，覆盖 `parseDonateCount`：
  - `"17/20"` → 17、`"0/20"` → 0、`"20/20"` → 20
  - `"25/20"`、`"99/20"` → clamp 20
  - `" /20"`、`""`、`"abc"`、`"/20"` → -1（兜底）
  - 无斜杠纯数字 `"7"` → 7
- action 本体依赖真实 ADB 截图/坐标/OCR 链路，不写单元测试，与 `claimAllianceTerritory` 等现有联盟 action 测试策略一致；由用户在模拟器上手动验证完整流程
- `npx tsc --noEmit` 通过
- `cd web && VITE_APP_EDITION=main npx tsc --noEmit` 通过

## 涉及文件

- 新增：`plugins/rok/actions/donateAllianceTech.ts`
- 新增：`plugins/rok/actions/donateAllianceTech.test.ts`
- 新增素材（已存在）：`plugins/rok/templates/lianmeng/icon_tuijian.png`、`btn_juanxian.png`
- 修改：`plugins/rok/index.ts`
- 修改：`plugins/rok/homeFeatures.ts`
- 修改：`web/src/pages/Home.tsx`
