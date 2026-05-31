# 邀请码系统设计

**目标：** 为已激活用户生成唯一邀请码，被邀请新用户激活后双方各获得免费时长奖励，促进用户增长。

**范围：** server-auth 后端（数据库 + API）+ 前端（首页显示邀请码 + 激活页填邀请码）。

---

## 1. 数据库变更

### activation_codes 新增字段

```sql
ALTER TABLE activation_codes ADD COLUMN type TEXT NOT NULL DEFAULT 'normal';
-- type: 'normal' | 'invite'
```

### invitations 新表

```sql
CREATE TABLE IF NOT EXISTS invitations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  invite_code_id INTEGER NOT NULL,
  inviter_fingerprint TEXT NOT NULL,
  invitee_fingerprint TEXT NOT NULL,
  inviter_bonus_days INTEGER NOT NULL,
  invitee_bonus_days INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  FOREIGN KEY (invite_code_id) REFERENCES activation_codes(id)
);
```

邀请奖励天数定义为常量，如双方各 `3` 天。

---

## 2. 后端 API

### 奖励常量

```typescript
const INVITE_BONUS_DAYS = 3;
```

### 2.1 激活时自动生成邀请码

修改 `useCode()` —— 首次激活成功后，为该设备自动插入一条邀请码：

```typescript
// 在 useCode() 首次激活成功的 transaction 内
const existingInvite = db.prepare(
  'SELECT id FROM activation_codes WHERE type = ? AND created_by = ?'
).get('invite', deviceFingerprint);

if (!existingInvite) {
  db.prepare(
    'INSERT INTO activation_codes (code, duration_days, status, type, created_at, created_by) VALUES (?, ?, ?, ?, ?, ?)'
  ).run(generateInviteCode(), INVITE_BONUS_DAYS, 'unused', 'invite', now, deviceFingerprint);
}
```

邀请码生成逻辑：`INV-` 前缀 + 8 位随机字符，区分于普通激活码。

### 2.2 获取我的邀请码

新增路由 `GET /api/auth/my-invite-code?fingerprint=xxx`：

```typescript
router.get('/my-invite-code', async (ctx) => {
  const fingerprint = ctx.query.fingerprint as string;
  if (!fingerprint) {
    ctx.status = 400;
    ctx.body = { success: false, error: '缺少设备指纹' };
    return;
  }
  const db = getDb();
  const row = db.prepare(
    "SELECT code FROM activation_codes WHERE type = 'invite' AND created_by = ?"
  ).get(fingerprint) as { code: string } | undefined;
  ctx.body = { success: true, code: row?.code || null };
});
```

### 2.3 useCode() 增加邀请码拦截

在 `useCode()` 开头增加防护：

```typescript
if (activationCode.type === 'invite') {
  return { success: false, error: '邀请码不能直接激活，请在激活码框输入购买的激活码' };
}
```

防止用户把邀请码当主激活码使用。

### 2.4 processInviteCode() — 独立邀请奖励逻辑

邀请码作为可选附加码，需配合主激活码使用。在 `/api/auth/activate` 路由中，主激活成功后，若提供了 `inviteCode`，调用此函数：

```typescript
function processInviteCode(inviteCode: string, inviteeFingerprint: string): {
  success: boolean;
  inviterBonusDays?: number;
  inviteeBonusDays?: number;
  error?: string;
} {
  const db = getDb();
  const now = Date.now();

  // 查找邀请码
  const codeRow = db.prepare(
    "SELECT * FROM activation_codes WHERE code = ? AND type = 'invite'"
  ).get(inviteCode) as ActivationCode | undefined;

  if (!codeRow) {
    return { success: false, error: '邀请码不存在' };
  }
  if (codeRow.status === 'used') {
    return { success: false, error: '邀请码已被使用' };
  }
  if (codeRow.status === 'revoked') {
    return { success: false, error: '邀请码已失效' };
  }

  // 被邀请人不能重复领取邀请奖励
  const alreadyInvited = db.prepare(
    'SELECT id FROM invitations WHERE invitee_fingerprint = ?'
  ).get(inviteeFingerprint);
  if (alreadyInvited) {
    return { success: false, error: '该设备已领取过邀请奖励' };
  }

  const inviterFingerprint = codeRow.created_by;

  // 查邀请人到期时间
  const inviterBinding = db.prepare(
    'SELECT * FROM device_bindings WHERE device_fingerprint = ?'
  ).get(inviterFingerprint) as { expires_at: number } | undefined;

  // 事务：消耗邀请码 + 奖励双方 + 记录邀请关系
  const transaction = db.transaction(() => {
    db.prepare('UPDATE activation_codes SET status = ?, used_at = ? WHERE id = ?')
      .run('used', now, codeRow.id);

    // 奖励邀请人：到期时间延长
    if (inviterBinding) {
      db.prepare('UPDATE device_bindings SET expires_at = ? WHERE device_fingerprint = ?')
        .run(Math.max(inviterBinding.expires_at, now) + INVITE_BONUS_DAYS * 86400000, inviterFingerprint);
    }

    // 奖励被邀请人：到期时间延长（在主激活已绑定的基础上加）
    db.prepare('UPDATE device_bindings SET expires_at = expires_at + ? WHERE device_fingerprint = ?')
      .run(INVITE_BONUS_DAYS * 86400000, inviteeFingerprint);

    // 记录邀请关系
    db.prepare(
      'INSERT INTO invitations (invite_code_id, inviter_fingerprint, invitee_fingerprint, inviter_bonus_days, invitee_bonus_days, created_at) VALUES (?, ?, ?, ?, ?, ?)'
    ).run(codeRow.id, inviterFingerprint, inviteeFingerprint, INVITE_BONUS_DAYS, INVITE_BONUS_DAYS, now);
  });

  try {
    transaction();
    return { success: true, inviterBonusDays: INVITE_BONUS_DAYS, inviteeBonusDays: INVITE_BONUS_DAYS };
  } catch (e: any) {
    return { success: false, error: e.message };
  }
}
```

**注意：** `processInviteCode` 在主激活码的 `useCode()` 成功之后调用，被邀请人的 `device_bindings` 已由主激活码创建。邀请奖励在此基础上延长到期时间。邀请人称 `expires_at` 延长；被邀请人称 `expires_at += bonus_days`。

---

## 3. 前端变更

### 3.1 首页 — 邀请入口

在合适位置（NavBar 右侧或首页）增加"邀请好友"按钮，点击后弹窗显示：

- 当前设备的邀请码（从 `GET /api/auth/my-invite-code` 获取）
- 复制按钮
- 奖励说明："你和好友各得 3 天免费使用"

### 3.2 激活页 — 邀请码输入

在激活码输入框下方增加可选输入：

```tsx
<input
  type="text"
  value={inviteCode}
  onChange={e => setInviteCode(e.target.value)}
  placeholder="邀请码（选填）"
/>
```

提交时在 body 中增加 `inviteCode` 字段。后端返回 `inviteBonus: true` 时显示"邀请奖励已发放！你和邀请人各获得 3 天"。

---

## 4. API 接口明细

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/auth/my-invite-code?fingerprint=xxx` | 获取设备的邀请码 |
| POST | `/api/auth/activate` | 新增可选 `inviteCode` 参数 |
| POST | `/api/auth/admin/invitations` | （admin）查看邀请记录 |

---

## 变更清单

| 文件 | 操作 | 说明 |
|------|------|------|
| `server-auth/services/AuthDatabase.ts` | 修改 | 新增 invitations 表、activation_codes.type 字段 |
| `server-auth/services/ActivationCodeService.ts` | 修改 | useCode 增加邀请处理、生成邀请码逻辑 |
| `server-auth/routes/auth.ts` | 修改 | 新增 /my-invite-code 路由 |
| `core/license/LicenseService.ts` | 修改 | activate 方法增加 inviteCode 参数 |
| `core/license/types.ts` | 修改 | ActivationResult 增加 inviteBonus 字段 |
| `web/src/pages/Activation.tsx` | 修改 | 增加邀请码输入框 + 奖励提示 |
| `web/src/App.tsx` | 修改 | 增加邀请入口按钮 + 弹窗 |

**不涉及：** 电子更新、Docker 配置、ROK 插件逻辑。
