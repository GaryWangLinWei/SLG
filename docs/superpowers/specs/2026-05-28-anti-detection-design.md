# Anti-Detection Enhancement — Design Spec

**Date:** 2026-05-28
**Status:** Approved

## Goal

加强防脚本检测能力，所有改动集中在核心层（AdbDevice + PluginContext），现有 action 代码零改动自动受益。

## Changes

### 1. Tap 模拟按压（AdbDevice.ts）

- 从 `input tap x y`（瞬时）改为 `input swipe x y x y <duration>`
- duration 随机 50-150ms，模拟人类手指按下时长
- 坐标偏移从 ±5px 改为 ±7px

### 2. Sleep 随机范围（AdbDevice.ts）

- `sleep(min, max?)` 新增可选 `max` 参数
- 传了 max：在 min-max 间随机取值，再叠加现有抖动
- 没传 max：保持现有行为（min 秒 + 抖动）
- 向后兼容，所有现有 `sleep(n)` 调用不受影响

### 3. Swipe 曲线化（AdbDevice.ts）

- 一次长 swipe 拆为 3-5 段小 swipe
- 每段终点在直线基础上加 ±7px 垂直偏移，形成微弧度
- 签名不变，调用方无感知

### 4. 子循环时间抖动（Home.tsx）

- gatherLoop / helpLoop / collectLoop 等待间隔改为 `baseTime * (0.85 + Math.random() * 0.3)`
- ±15% 随机，如 60s → 51-69s，4h → 3.4h-4.6h

### 5. Idle-drag 触发调整（Home.tsx）

- 触发条件：等待 > 120s（原 300s）
- 触发概率：40%（原 30%）

### 6. 微停顿（PluginContext.ts）

- `sleep()` 结束时 5% 概率追加 0.3-0.8s 停顿
- `tap()` 点击后 10% 概率追加 0.2-0.5s 停顿
- 模拟注意力分散和操作犹豫

## 涉及文件

| 文件 | 改动 |
|------|------|
| `core/device/AdbDevice.ts` | Tap 按压、sleep 范围、swipe 曲线、偏移量 |
| `core/device/Device.test.ts` | 新增测试用例覆盖上述改动 |
| `core/plugin/PluginContext.ts` | sleep/tap 微停顿 |
| `web/src/pages/Home.tsx` | 子循环抖动、idle-drag 参数调整 |

## 不变项

- 不改任何 action 文件
- 不改任何 config 常量
- 不增加 UI 可配置项
