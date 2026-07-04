# 攻击检测与自动开盾设计

## 背景

当城被攻击时，ROK 会在屏幕右下角区域 (1253,651)-(1589,781) 显示 `Icon_Attack.png` 图标（预警约 5 分钟）。当前系统各子循环串行占用设备锁，如果没有独立的检测通道，一次宝石采集/城寨集结/山洞探索的操作周期可能长达十几秒，延误开盾时机。

需要一个独立的攻击检测子循环，5 秒一次纯读屏（不抢锁、不动设备），命中后举起抢占旗打断后续子循环，再执行自动开盾。

## 目标

- 攻击图标出现到日志记录/开盾动作启动 ≤ 5 秒
- 检测本身不与其它子循环互相延误
- 用户可独立开关"检测"和"自动开盾"

## 非目标

- 不实现自动回兵（后续再做）
- 不实现进军路径回避（把敌人挡在城外）
- 不实现攻击者信息识别

## 需求

### 用户可配置

- `attackDetectEnabled: boolean`（默认 false）— 攻击检测总开关
- `autoShieldEnabled: boolean`（默认 false）— 检测到攻击时是否自动开盾，禁用当 `attackDetectEnabled = false`

UI 位置：Home.tsx "社交与辅助" 卡片，"自动帮助盟友" 下方。

### 检测行为

- 每 5 秒截取区域 (1253,651)-(1589,781)（336×130）
- 用 `findImage(Icon_Attack.png, 0.75)` 在该区域内搜索（图标位置可能移动）
- 检测本身不占用 `deviceBusy` 锁 — ADB `screencap` 并发安全
- 命中时输出日志 `⚠️ 检测到被攻击`

### 抢占与执行

- 检测命中后设置 `attackPreempt = true`
- 其它子循环的 `acquireLock()` 加 `while (deviceBusy || attackPreempt)` 检查，让路（不设超时）
- 当前正在执行的 action **不中断**（软等待）— 等它 `releaseLock()` 自然释放
- 攻击循环 `acquireLock()` 拿到锁后：若 `autoShieldEnabled = true`，执行 `auto-shield`；否则只记日志
- 执行完毕 → `releaseLock()` → `attackPreempt = false`

### 自动开盾流程

1. 展开底部栏（独立状态检测，失败即放弃）
2. tap (1037,839) 打开道具
3. tap (785,105) 切到增益页签
4. `findImage(icon_hudun.png, 0.75)`
   - 未找到 → 跳到步骤 6
   - 找到 → tap 图标 → tap (1229,769) 使用
5. sleep 1s → `findImage(btn_cancel.png, 0.75)`（判断"是否继续使用"弹窗）
   - 找到 → 已在盾中 → tap 否按钮
   - 未找到 → 开盾成功
6. tap (1392,105) 关闭道具面板
7. 收回底部栏（独立状态检测，失败即放弃）

### 底部栏状态检测辅助

新增 `ensureBottomBarState(ctx, target: 'expanded' | 'collapsed'): Promise<boolean>`

- 截取 (1410,837) 附近区域 vs `pop_mailBtn.png` 模板
- 判断当前状态；与 `target` 一致 → 返回 true
- 与 `target` 不一致 → tap (1539,837) → 再检测一次
- 仍不一致 → 记日志并返回 false（**放弃**，不重试）
- 与现有 `ensureBottomBarCollapsed` 共存，不用 `bottomBarChecked` 缓存

## 架构

### 数据流

```
Home.tsx attackLoop (子循环, 5s 间隔)
  └── runTask('check-attack')     // 不抢锁
        └── ctx.captureRegion + Vision.findImage(Icon_Attack.png)
              └── 日志: [CHECK-ATTACK] attacked=true/false
  └── if attacked:
        ├── setLogs("⚠️ 检测到被攻击")
        ├── if !features.autoShieldEnabled: continue
        ├── attackPreempt = true
        ├── while (deviceBusy) await sleep(0.3)
        ├── acquireLock()
        ├── runTask('auto-shield')
        └── finally: releaseLock() + attackPreempt = false

其它子循环 (gem / cave / rally / join / help / collect ...)
  └── acquireLock() { while (deviceBusy || attackPreempt) await sleep(0.3) }
```

### 新增文件

- `plugins/rok/actions/checkAttack.ts` — check-attack action
- `plugins/rok/actions/autoShield.ts` — auto-shield action

### 修改文件

- `plugins/rok/homeFeatures.ts` — 两个新字段 + 默认值
- `plugins/rok/utils/location.ts` — 新增 `ensureBottomBarState`
- `plugins/rok/index.ts` — 注册两个 action
- `web/src/pages/Home.tsx` — 抢占旗、`acquireLock` 改造、`attackLoop`、UI 卡片

## 关键约束

- 检测频率 5s，区域内 findImage 阈值 0.75
- 抢占无超时：`attackPreempt` 立起后，其它循环无限等待直到落旗
- 攻击 action 内部所有底部栏状态检测均**独立**（不复用 `ctx.bottomBarChecked` 缓存）
- 状态检测失败一次立即放弃（不重试）

## 测试

- 单元：`ensureBottomBarState` 两种目标状态、状态不一致 → tap → 再检测的行为
- 手工：
  1. 未启用检测 → 攻击时无反应 ✓
  2. 启用检测、未启用开盾 → 日志出现"⚠️ 检测到被攻击"、其它子循环正常 ✓
  3. 启用检测 + 开盾，无盾时（模拟）→ 日志"未找到护盾"，其它循环 ≤ 5s 恢复
  4. 启用检测 + 开盾，无盾中 → 完整开盾流程
  5. 启用检测 + 开盾，已在盾中 → 检测到 `btn_cancel.png`，点否，无副作用
  6. 开盾时其它循环正好在跑（如宝石搜索）→ 攻击循环等到 releaseLock 后接管

## 涉及文件

| 用途 | 路径 |
|------|------|
| 攻击检测 action | `plugins/rok/actions/checkAttack.ts`（新） |
| 自动开盾 action | `plugins/rok/actions/autoShield.ts`（新） |
| 底部栏状态辅助 | `plugins/rok/utils/location.ts` |
| 功能开关声明 | `plugins/rok/homeFeatures.ts` |
| 插件注册 | `plugins/rok/index.ts` |
| UI + 主循环 | `web/src/pages/Home.tsx` |
| 攻击图标模板 | `plugins/rok/templates/Icon_Attack.png`（已存在） |
| 护盾图标模板 | `plugins/rok/templates/icon_hudun.png`（用户已放置） |
| 取消按钮模板 | `plugins/rok/templates/btn_cancel.png`（用户已放置） |
| 底部栏模板 | `plugins/rok/templates/pop_mailBtn.png`（已存在） |
