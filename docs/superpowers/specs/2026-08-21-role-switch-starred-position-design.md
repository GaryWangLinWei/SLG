# 切号机制重设计：星标位置式角色切换 + 类型自动推导

日期：2026-08-21
状态：已评审定稿

## 一、背景与目标

现有切号机制有两种路径：

1. **常规账号切换**（`switchAccount.ts`）：不同游戏账号之间切换，OCR 下拉列表匹配账号编号。
2. **连体角色切换**（`switchLinkedRole.ts`）：同一账号内主号↔连体角色切换，按两个固定坐标盲点。

问题：

- 连体切换**只支持恰好 2 个角色**（坐标硬编码 + `resolveSwitchKind` 只有双向 + UI 配对约束三层锁死）。
- 用户实际经常在一个账号下建多个角色（游戏允许同服最多 2 角色、一个账号可建大量角色），需要轮换 N 个角色。
- 数据模型（`targetType: 'account' | 'linked'` + 配对约束）复杂，用户需要理解"连体号必须配对主号"等隐式规则。

目标：

- 支持同一账号下 **N 个角色**参与轮换。
- 支持**混合轮换**（不同账号 + 同账号多角色混排）。
- 简化用户心智：不需要手动设置类型，类型由系统从切号列表自动推导。

## 二、关键设计决策

### 2.1 角色定位：星标位置索引，不用 OCR

角色管理界面是两列、可滚动的网格（每屏 6 个格子：2 列 × 3 行）。角色名是用户自定义的（含繁体、符号），不可靠；服务器号不唯一（同服可 2 角色）；战力需要消歧且引入全列表扫描成本。

**最终决策**：用户把需要参与调度的角色在游戏内**加星标**。星标区钉在列表顶部，**按添加顺序排列、不变动就不重排**（用户确认）。因此星标序号是稳定索引：

- 配置：`starredIndex`（星标列表第几个，1 开始）
- 执行：进角色管理 → 上滑归顶 → `index > 6` 时下滑 `⌊(index-1)/6⌋` 屏 → 点 `((index-1)%6)+1` 号位固定坐标 → 确认登录
- 零 OCR，确定性执行

取舍：星标变动后位置漂移，由用户更新配置兜底（不做切号后校验，保持简单）。

### 2.2 类型自动推导，用户不设置 targetType

原方案让用户在 Config 页选择 `account / role` 类型，对用户理解成本过高。改为从切号列表推导：

> 切号列表中某 `accountName` 只出现 1 次 → 该 profile 按 account 型处理（只切账号，落点即正确角色）
> 出现 ≥2 次 → 这些 profile 按 role 型处理（必须各有互不相同的 `starredIndex`）

### 2.3 混合轮换的切换组合规则

目标是 role 型且所属账号与当前不同时，需要"先切账号再切角色"。注意多角色账号被离开再回来时，切账号会落在该账号最近使用的角色上（可能不是目标），因此：

> **目标是 account 型** → 只切账号
> **目标是 role 型** → 账号不同则先切账号，然后**总是**位置切角色

"总是切角色"的代价：偶尔落在正确角色上时重点一次（多等一次登录），但只发生在首轮；稳态下每步都需要，不多花。

### 2.4 单 action 显式步骤

前端算好步骤，一次性传给 `switch-account` action 顺序执行，而非前端调度两个 action：一次任务、一条日志、原子执行，无二次调度竞态。

### 2.5 删除隐式推断逻辑

`resolveSwitchKind`（"编号相同 + linked → 角色切换"）删除。切哪条路径完全由前端推导出的显式步骤决定。

## 三、数据模型

```ts
accountSwitch: {
  accountName: string      // 游戏账号编号，必填
  starredIndex?: number    // 星标序号（1 开始），仅同账号多 profile 参与轮换时需要
}
```

- **删除 `targetType` 字段**（不存储，运行时推导）。
- `DEFAULT_ROK_CONFIG` 同步更新：`accountSwitch: { accountName: '', starredIndex: undefined }`。
- 一个 profile = 一个游戏身份（哪个账号 + 可选哪个角色）+ 该身份激活时的功能开关。

## 四、类型推导与校验（Home 页）

```text
profiles = 切号列表中非空的 switchProfileIds 对应的配置
按 accountSwitch.accountName 分组：
  组大小 = 1  → account 型
  组大小 ≥ 2  → role 型，要求组内每个 profile 的 starredIndex 已填且互不相同
```

校验不通过：对应槽位置灰 + 提示文案（"该账号有多个角色方案，请到配置页补填星标序号"）。account 型 profile 填了 `starredIndex` 也忽略。

## 五、切换执行

### 5.1 action 参数

`switch-account` action 接收显式步骤：

```ts
params = {
  accountSwitch?: { accountName: string }  // 目标账号 ≠ 当前账号时存在
  roleSwitch?: { starredIndex: number }    // 目标是 role 型时存在
}
```

当前账号 = 激活 profile 的 `accountSwitch.accountName`。执行顺序：先 `accountSwitch`（若存在），再 `roleSwitch`（若存在）；任一失败按现有重试逻辑处理（最多重试 2 次）。

**重试幂等性**：重试时前端按当前逻辑状态重算步骤。若上一次尝试已完成账号切换、仅角色切换失败，重试会再次包含 `accountSwitch`——此时设备已在目标账号上，该步骤必须容忍"目标即当前账号"的情况（跳过或接受重选，不得进入"找不到目标→重启游戏"的失败分支）。

### 5.2 账号切换（沿用）

`switchAccount.ts` 不变：头像(1358,747) → 设置 → `icon_account` → 切换账号 → 展开下拉 → OCR 匹配编号（含 0↔9 容错）→ 确认 → `waitForCityAfterLogin`；OCR 连续 5 次失败 → `am force-stop` 重启游戏重试。

### 5.3 角色切换（重写）

重写 `switchLinkedRole.ts` 为位置式，零 OCR：

1. 头像(1358,747) → 设置 → `icon_role` 模板匹配进角色管理
2. 上滑 2-3 次确保到达列表顶部（归一化起点）
3. `starredIndex > 6` 时下滑 `⌊(starredIndex-1)/6⌋` 屏
4. 点击 `((starredIndex-1)%6)+1` 号位固定坐标
5. `btn_surelogin` 确认 → `waitForCityAfterLogin` 等进城

坐标表（1600×900）：

| 位置 | 坐标 |
|---|---|
| 1 | (320, 334)（沿用现有 MAIN_CHAR_BTN） |
| 2 | (909, 334)（沿用现有 LINKED_CHAR_BTN） |
| 3 | (320, ~483)（实施时实测标定） |
| 4 | (909, ~483)（实施时实测标定） |
| 5 | (320, ~641)（实施时实测标定） |
| 6 | (909, ~641)（实施时实测标定） |

滑动距离实施时标定，保证一次下滑恰好推进 6 格。

## 六、UI 改动

### Config 页（`web/src/pages/Config.tsx`）

- 删除"类型"下拉（原 account/linked）。
- 保留账号编号输入。
- 新增"星标序号"数字输入框（可空；account 型下填了也忽略）。

### Home 页调度槽位（`web/src/pages/Home.tsx:2853-2958`）

- 删除全部连体配对约束：`neighborLinked`（相邻禁连体）、`hasLinkedMaster`（连体必须配主号）。
- 新增唯一校验：同账号多 profile 时 `starredIndex` 必填且互不相同，不满足置灰 + 提示。
- 槽位数不变：`MAX_SWITCH_SLOTS = DEV ? 4 : 2`（prod 2 槽是后续按槽位收费的商业设计，非技术限制；dev 4 槽用于功能验证）。

## 七、调度器加固（随本次修复）

1. **环向轮换**：`switchTargetIdx` 改为在 `validIds` 上 `(curIdx + 1) % validIds.length` 推进，替换现有 `findIndex(x => x !== nextProfile)` 的双账号假设（`Home.tsx:1367`）。
2. **去重 profile 元信息加载**：`Home.tsx:630-646` 与 `653-682` 两段几乎相同的 `Promise.all` 拉账号信息合并为单个 `refreshProfileAccountMeta()`。
3. **去重"载入新 profile 功能"**：`accountSwitchLoop`（`Home.tsx:1341-1361`）与 `handleConfigSwitch`（`Home.tsx:684-733`）重复的"下载 homeFeatures → preserveGlobalFields 注入"合并。
4. **`switchIntervalMinutes` 类型统一**：`number | number[]` 双形态统一为 `number[]`（`homeFeatures.ts:94`），UI 与调度器各做一次转换的问题消除。

## 八、老配置兼容

- 读取时忽略旧 `targetType` 字段（不报错、不迁移）。
- 旧 `linked` profile 语义上等价于 role 型，但缺 `starredIndex` → Home 页校验提示补填，在此之前该 profile 不参与 role 型轮换。
- `accountName` 原样保留。

## 九、明确不做（Out of Scope）

- 角色定位不用 OCR（用户已否决：名字不可靠、服务器号不唯一、全列表扫描成本高）。
- 不做切号后身份校验（信任星标位置；漂移由用户更新配置兜底）。
- 不改动账号切换的 OCR 流程。
- prod 槽位数不放开（商业决策：按槽位收费）。

## 十、验证方式

- **单测**：类型推导（分组 + starredIndex 唯一性校验）、环向 `switchTargetIdx` 推进逻辑——纯逻辑可测。
- **类型检查**：`npx tsc --noEmit` + `cd web && npm run build`。
- **真机 E2E**（dev 4 槽，模拟器手动验证）：
  - `[A, B]` 两账号互切（回归现有路径）
  - `[B①, B②]` 单账号双角色位置切换
  - `[A, B①, B]` 混合轮换，重点验证 `A → B①` 在 B 最近使用为 ② 时仍落在 ①
  - `starredIndex > 6` 的跨屏滚动
  - 老配置（含 `targetType: 'linked'`）加载不报错、提示补填

## 十一、关键文件

| 改动 | 文件 |
|---|---|
| action 参数与注册 | `plugins/rok/index.ts:971-994` |
| 默认配置 | `plugins/rok/index.ts:176-179` |
| 角色切换重写 | `plugins/rok/actions/switchLinkedRole.ts` |
| 删除 | `plugins/rok/actions/switchAccountKind.ts` |
| 账号切换（不变） | `plugins/rok/actions/switchAccount.ts` |
| 推导/校验/调度/UI | `web/src/pages/Home.tsx` |
| 配置页 UI | `web/src/pages/Config.tsx:399-418` |
| 字段定义 | `plugins/rok/homeFeatures.ts:94` |
