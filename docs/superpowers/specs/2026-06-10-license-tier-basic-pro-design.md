# License Tier: Basic / Pro

**Date:** 2026-06-10
**Status:** approved

## Overview

将激活码分为两个权限等级：Basic 和 Pro。Pro 解锁高阶功能（如宝石采集），Basic 用户看到 Pro 功能时显示灰掉 + Pro 角标。

## Motivation

当前所有激活码没有权限分级。随着高阶功能（宝石采集、后续新增的功能）的加入，需要区分付费等级。

## Design Decisions

| 决策 | 选择 | 原因 |
|------|------|------|
| Tier 数据归属 | 挂在激活码上 (`activation_codes.tier`) | 激活码是分发源头，和现有的 duration_days 同层 |
| 客户端存储 | `StoredLicenseData.tier`（本地加密存储） | 心跳失败离线模式下仍能判断权限 |
| 老用户迁移 | 默认 `basic` | 不影响现有用户功能 |
| 升级方式 | 输入 Pro 激活码覆盖 | 与现有激活码输入流程一致，用户自助 |
| 续费规则 | 同 tier 累加，不同 tier 重置 | 与现有续费逻辑一致 |
| UI 表现 | 灰掉 + Pro 角标 + hover 提示 | 用户可见功能存在但需要升级 |

## Data Model

### server-auth: `activation_codes` 表

```sql
ALTER TABLE activation_codes ADD COLUMN tier TEXT NOT NULL DEFAULT 'basic';
-- 值: 'basic' | 'pro'
```

`ActivationCode` 接口新增 `tier?: 'basic' | 'pro'`。

### server-auth: `generateCodes()` 签名

```typescript
generateCodes(count: number, durationDays?: number, tier?: 'basic' | 'pro'): ActivationCode[]
```

### 客户端: `StoredLicenseData` & `LicenseStatus`

```typescript
// core/license/types.ts — 各加一个字段
interface StoredLicenseData {
  // ... existing fields
  tier: 'basic' | 'pro';
}

interface LicenseStatus {
  // ... existing fields
  tier: 'basic' | 'pro';
}
```

## API Changes

### server-auth `/api/auth/activate`

Response 新增 `tier`:
```json
{ "success": true, "token": "...", "expiresAt": 1234567890, "tier": "pro" }
```

### server-auth `/api/auth/heartbeat`

Response 新增 `tier`（兜底，通常不变）。

### server-auth `/api/auth/preview`

Response 新增 `tier`。

### server `/api/license/status`

从本地 `StoredLicenseData` 读取 tier 返回。

### server `/api/license/heartbeat`

心跳成功时若服务端返回不同 tier 则更新本地。

## Renewal Logic (server-auth `useCode()`)

| 场景 | 时间 | tier |
|------|------|------|
| Basic → Basic | 累加 | basic |
| Pro → Pro | 累加 | pro |
| Basic → Pro | 重置 | pro |
| Pro → Basic | 重置 | basic |

## Frontend

### LicenseContext

```typescript
const tier = status?.tier || 'basic';
const isPro = tier === 'pro';
```

### Pro Feature Gating

在 `Home.tsx` 维护 Pro 功能 ID 列表：

```typescript
const PRO_FEATURES = ['gemGather'];
```

渲染规则：
- `isPro` → 正常显示
- `!isPro` && feature 在 `PRO_FEATURES` 中 → 开关灰掉不可点击，显示金色 "Pro" 角标

### Pro 角标

- 金黄色圆形标签，文字 "PRO"
- hover 显示 tooltip: "升级到 Pro 解锁"
- 点击灰掉的开关时不触发任何操作

### 激活页

激活成功后根据 `tier` 显示对应文案和徽章：
- Basic: "基础版 · 30天"
- Pro: 金色 "PRO" 徽章 + "Pro 版 · 30天"

### 测试激活码

客户端 mock 的测试码对应 tier：
| 码 | tier |
|----|------|
| `DEMO-123456` | basic |
| `RENEW-SAME` | basic |
| `RENEW-UP` | pro |
| `RENEW-DOWN` | basic |

## Files to Change

| 文件 | 改动 |
|------|------|
| `server-auth/services/AuthDatabase.ts` | `activation_codes` 表加 `tier` 列 |
| `server-auth/services/ActivationCodeService.ts` | `generateCodes()` 加 tier 参数；`useCode()` 处理续费 tier 逻辑；`ActivationCode` 接口加 tier |
| `server-auth/routes/auth.ts` | activate / heartbeat 响应返回 tier |
| `server-auth/routes/admin.ts` | 管理后台生成码时可指定 tier |
| `core/license/types.ts` | `StoredLicenseData` + `LicenseStatus` 加 tier |
| `core/license/LicenseService.ts` | activate / heartbeat 解析和存储 tier；测试码更新 |
| `server/routes/license.ts` | status 透传 tier |
| `web/src/contexts/LicenseContext.tsx` | LicenseStatus 加 tier |
| `web/src/pages/Home.tsx` | Pro 功能门控 + Pro 角标组件 |
| `web/src/pages/Activation.tsx` | 激活成功显示 tier 信息 |
| `web/src/api/client.ts` | license 接口类型更新 |

## Out of Scope

- server-auth 管理后台 Web UI（生成码时选 tier 的界面）— 先用 API 参数
- Pro 功能对应的后端 action 拦截（仅前端门控，后端不做双重校验）
- 按账号粒度的 tier（tier 是整个许可证级别的）
