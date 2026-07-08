# 自动切号（游戏内多小号轮换）

## 背景与目标

同一模拟器上登了 2 个万国觉醒账号，希望自动轮流切号，每个账号使用一套独立的坐标配置方案跑首页循环。切一次号 = 一轮任务过完后自动切下一个号。

## 范围

- **游戏内切号**（头像 → 用户中心 → 切换账号 → 选择账号 → 登录），不涉及模拟器切换
- **限制 2 个账号**（对应切号下拉里的两个 OCR 区域，无需滑动/翻页）
- 每个账号复用现有 `RokConfig` 配置方案（Config 页里已有的多方案系统）

## 数据结构

### `RokConfig` 新增（每个配置方案独立）

```ts
accountSwitch: {
  accountName: string;   // 账号编号，如 "241872258"（空 = 不参与轮换）
}
```

### `HomeFeatures` 新增（全局，localStorage 持久化）

```ts
autoSwitchAccount: boolean;             // 总开关
switchMode: 'per-round' | 'per-time';   // 切号触发方式
switchIntervalMinutes: number;          // per-time 模式的间隔，默认 30
switchProfileIds: string[];             // 参与轮换的配置方案 ID（恰好 2 个）
```

## 切号 action

`plugins/rok/actions/switchAccount.ts`

**参数：** `{ targetName: string }` — 目标账号编号

**返回：** `'success' | 'not_found' | 'settings_failed' | 'load_timeout'`

**流程：**

1. 点头像中心 `(58, 48)`（区域 (34,23)-(83,73) 中心）→ sleep 0.5s
2. 点设置按钮中心 `(1358, 747)`（区域 (1329,719)-(1388,775) 中心）→ sleep 1s
3. `findImage(icon_account.png)`
   - 未找到 → 返回 `settings_failed`
   - 找到 → 点击 → sleep 1s
4. 点"切换账号"按钮 `(727, 97)` → sleep 1s
5. 点下拉按钮 `(994, 408)` → sleep 0.5s
6. OCR 区域 1 `(676, 495)-(862, 520)`，白名单 `0-9`
7. OCR 区域 2 `(676, 569)-(862, 594)`，白名单 `0-9`
8. `.includes(targetName)` 匹配：
   - 匹配区域 1 → 点 `(769, 508)`
   - 匹配区域 2 → 点 `(769, 582)`
   - 均不匹配 → 返回 `not_found`
9. 点登录按钮 `(802, 487)`
10. 等加载（与 `launchGame.ts` 一致）：
    - sleep 15s
    - 在 `TAP_REGION (324,256)-(1231,798)` 内随机点一下
    - sleep 15s
    - 每 2s 调 `getCurrentLocation`，最多再等 60s
    - 返回 `city` → `success`；超时 → `load_timeout`

**上层重试策略：** Home 主循环调用时最多重试 2 次，都失败则跳过该账号。

## Home.tsx 主循环改造

### 新增 refs / state

- `switchTargetIdxRef` — 当前轮到 `switchProfileIds` 的第几个
- `pendingSwitchRef` — 切号触发 flag
- `switchTimerRef` — per-time 模式的 setTimeout 句柄

### 主 while 循环改造点

**顶部（每次迭代开始）：**

```
if (features.autoSwitchAccount && pendingSwitchRef.current) {
  pendingSwitchRef.current = false
  target = switchProfileIds[(currentIdx + 1) % switchProfileIds.length]
  targetProfile = configProfiles.find(p => p.id === target)
  targetName = targetProfile.rok.accountSwitch.accountName
  if (!targetName) { 跳过, currentIdx++, continue }

  acquireLock
  ok = false
  for (attempt of [1, 2]) {
    result = runAction('switch-account', { targetName })
    if (result === 'success') { ok = true; break }
  }
  if (ok) {
    api.config.switch(target)
    await refreshFeatures + refreshRokConfig
    resetAllCooldowns()
    currentIdx = (currentIdx + 1) % switchProfileIds.length
  } else {
    log 跳过该号
    currentIdx = (currentIdx + 1) % switchProfileIds.length
  }
  releaseLock
}
```

**底部（sleep 前）：**

```
if (features.autoSwitchAccount && features.switchMode === 'per-round') {
  pendingSwitchRef.current = true
}
```

**启动循环时（per-time 模式）：**

```
if (features.switchMode === 'per-time') {
  scheduleSwitchTimer(features.switchIntervalMinutes)
}
```

`scheduleSwitchTimer` 用 setTimeout 到点置 `pendingSwitchRef = true` 并递归重设。

**停止循环时：** clearTimeout。

### `resetAllCooldowns()`

集中把所有子任务 CD refs 归零：`lastRallyFortAt`、`lastGemAt`、`lastCaveExploreAt` 等。具体列表在实现时列出。

## UI

### Home 页新增卡片「自动切号」

- 总开关 checkbox
- 模式单选：按轮次 / 按时间
  - 按时间：分钟输入框
- 参与账号列表：
  - 两个下拉：**账号 1 / 账号 2**（各自选一个配置方案）
  - 提示文字："每个配置方案需在 Config 页填写账号编号"

### Config 页配置方案编辑区新增

- "账号编号" 输入框（`rok.accountSwitch.accountName`），占位符 `241872258`

## 需要新增的模板图

- `icon_account.png` — 用户中心页里的「账号」按钮图标（供 `findImage` 定位）

## 边界情况

| 情况 | 处理 |
|------|------|
| 目标账号 `accountName` 为空 | 跳过，切下一个 |
| OCR 两个区域都不匹配 | 返回 `not_found`，上层重试 2 次后跳过 |
| 加载超过 60s 未回城内 | 返回 `load_timeout`，上层重试 2 次后跳过 |
| `switchProfileIds` 不足 2 个或有一项账号编号为空 | 循环不启用切号，跟单号一样跑 |
| 用户切号过程中点停止 | `checkStop` 在 tap/sleep 前检查，正常中断 |
| per-time 计时中 flag 未清 | 切号执行完清 flag，下一次 timeout 到再置 true |

## 验证方式

1. 配置 2 个配置方案，各填一个账号编号
2. 首页开总开关，选按轮次模式，两个方案都加入轮换
3. 启动循环 → 一轮跑完 → 自动切号 → 跑另一个 → 循环
4. 用无效编号测试 not_found 跳过
5. 切号中点停止，确认能中断

## 关键文件

- `plugins/rok/homeFeatures.ts` — 新增字段
- `plugins/rok/index.ts` — 新增 `accountSwitch` 到 DEFAULT_ROK_CONFIG，注册 switch-account action
- `plugins/rok/actions/switchAccount.ts` — 新建
- `plugins/rok/actions/launchGame.ts` — 导出 `TAP_REGION` 供复用
- `web/src/pages/Home.tsx` — 主循环 + UI 卡片
- `web/src/pages/Config.tsx` — 账号编号输入框
- `plugins/rok/templates/icon_account.png` — 用户新增
