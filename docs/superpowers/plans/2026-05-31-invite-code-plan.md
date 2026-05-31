# 邀请码系统 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为已激活用户生成唯一邀请码，被邀请新用户激活后双方各获得 3 天免费时长。

**Architecture:** server-auth 新增 `invitations` 表 + `activation_codes.type` 字段；后端新增 `processInviteCode()` 函数和 `/my-invite-code` 路由；前端在激活页加邀请码输入、首页加邀请入口弹窗。

**Tech Stack:** TypeScript (server-auth Koa), better-sqlite3, React + Vite (前端)

---

### Task 1: 数据库迁移 — invitations 表 + type 字段

**Files:**
- Modify: `server-auth/services/AuthDatabase.ts:19-62`

- [ ] **Step 1: 修改 initTables()，添加 invitations 表和 type 字段**

在 `server-auth/services/AuthDatabase.ts` 的 `initTables()` 函数末尾（索引创建之前）添加：

```typescript
  // 邀请关系表
  database.exec(`
    CREATE TABLE IF NOT EXISTS invitations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      invite_code_id INTEGER NOT NULL,
      inviter_fingerprint TEXT NOT NULL,
      invitee_fingerprint TEXT NOT NULL,
      inviter_bonus_days INTEGER NOT NULL,
      invitee_bonus_days INTEGER NOT NULL,
      created_at INTEGER NOT NULL,
      FOREIGN KEY (invite_code_id) REFERENCES activation_codes(id)
    )
  `);

  // activation_codes 新增 type 字段（如果不存在）
  try {
    database.exec(`ALTER TABLE activation_codes ADD COLUMN type TEXT NOT NULL DEFAULT 'normal'`);
  } catch { /* 字段已存在，忽略 */ }
```

添加索引：
```typescript
  database.exec('CREATE INDEX IF NOT EXISTS idx_invitations_inviter ON invitations(inviter_fingerprint)');
  database.exec('CREATE INDEX IF NOT EXISTS idx_invitations_invitee ON invitations(invitee_fingerprint)');
```

- [ ] **Step 2: 本地验证 — 启动 server-auth 确认建表成功**

```bash
cd D:\SLG\server-auth && npx tsc && node -e "
const { getDb } = require('./dist/services/AuthDatabase');
const db = getDb();
const cols = db.prepare('PRAGMA table_info(invitations)').all();
console.log('invitations columns:', cols.map(c => c.name).join(', '));
const cols2 = db.prepare('PRAGMA table_info(activation_codes)').all();
console.log('activation_codes columns:', cols2.map(c => c.name).join(', '));
"
```

预期输出：`invitations` 表包含 7 列；`activation_codes` 包含 `type` 列。

- [ ] **Step 3: 提交**

```bash
cd D:\SLG
git add server-auth/services/AuthDatabase.ts server-auth/dist/
git commit -m "feat: add invitations table and activation_codes.type field"
```

---

### Task 2: ActivationCodeService — 邀请码逻辑

**Files:**
- Modify: `server-auth/services/ActivationCodeService.ts`

- [ ] **Step 1: 添加常量和 generateInviteCode()**

在文件顶部，`generateCode()` 函数附近添加：

```typescript
const INVITE_BONUS_DAYS = 3;

function generateInviteCode(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // 去掉易混淆的 0/O/1/I
  let result = 'INV-';
  for (let i = 0; i < 8; i++) {
    result += chars[Math.floor(Math.random() * chars.length)];
  }
  return result;
}
```

- [ ] **Step 2: 修改 useCode() — 首次激活成功后自动生成邀请码**

在 `useCode()` 的 `transaction` 内部，`insertBinding.run()` 之后，添加：

```typescript
    // 首次激活成功后自动生成邀请码
    const existingInvite = db.prepare(
      "SELECT id FROM activation_codes WHERE type = 'invite' AND created_by = ?"
    ).get(deviceFingerprint);
    if (!existingInvite) {
      db.prepare(
        'INSERT INTO activation_codes (code, duration_days, status, type, created_at, created_by) VALUES (?, ?, ?, ?, ?, ?)'
      ).run(generateInviteCode(), INVITE_BONUS_DAYS, 'unused', 'invite', now, deviceFingerprint);
    }
```

- [ ] **Step 3: 修改 useCode() — 开头增加邀请码拦截**

在 `useCode()` 中 `getCode()` 之后、status 判断之前，添加：

```typescript
  if (activationCode.type === 'invite') {
    return { success: false, error: '邀请码不能直接激活，请使用购买的激活码' };
  }
```

- [ ] **Step 4: 添加 processInviteCode() 函数**

在文件末尾（`exportCodes` 之后）添加：

```typescript
export function processInviteCode(inviteCode: string, inviteeFingerprint: string): {
  success: boolean;
  inviterBonusDays?: number;
  inviteeBonusDays?: number;
  error?: string;
} {
  const db = getDb();
  const now = Date.now();

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
    'SELECT * FROM device_bindings WHERE device_fingerprint = ? ORDER BY bound_at DESC LIMIT 1'
  ).get(inviterFingerprint) as { expires_at: number } | undefined;

  // 事务：消耗邀请码 + 奖励双方 + 记录邀请关系
  const transaction = db.transaction(() => {
    db.prepare('UPDATE activation_codes SET status = ?, used_at = ? WHERE id = ?')
      .run('used', now, codeRow.id);

    // 奖励邀请人
    if (inviterBinding) {
      const newExpiresAt = Math.max(inviterBinding.expires_at, now) + INVITE_BONUS_DAYS * 86400000;
      db.prepare('UPDATE device_bindings SET expires_at = ? WHERE id = (SELECT id FROM device_bindings WHERE device_fingerprint = ? ORDER BY bound_at DESC LIMIT 1)')
        .run(newExpiresAt, inviterFingerprint);
    }

    // 奖励被邀请人：在主激活已绑定的基础上加天数
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

- [ ] **Step 5: 编译验证**

```bash
cd D:\SLG\server-auth && npx tsc
```

预期：编译成功，无错误。

- [ ] **Step 6: 提交**

```bash
cd D:\SLG
git add server-auth/services/ActivationCodeService.ts server-auth/dist/
git commit -m "feat: add processInviteCode and auto-generate invite codes on activation"
```

---

### Task 3: Auth 路由 — /my-invite-code + activate 路由更新

**Files:**
- Modify: `server-auth/routes/auth.ts`

- [ ] **Step 1: 更新 import**

```typescript
import { useCode, processInviteCode } from '../services/ActivationCodeService';
```

（将原有的 `import { useCode }` 改为 `import { useCode, processInviteCode }`）

- [ ] **Step 2: 修改 /api/auth/activate 路由**

在 `useCode()` 调用成功之后，`ctx.body` 返回之前，添加邀请码处理：

```typescript
  // 处理邀请码（主激活成功后）
  let inviteResult: any = null;
  if (inviteCode) {
    inviteResult = processInviteCode(inviteCode, fingerprint);
  }

  if (result.success) {
    // ... 现有逻辑 ...
    ctx.body = {
      success: true,
      token,
      expiresAt: result.expiresAt,
      ...(inviteResult?.success ? { inviteBonus: true, inviterBonusDays: inviteResult.inviterBonusDays, inviteeBonusDays: inviteResult.inviteeBonusDays } : {}),
      ...(inviteResult && !inviteResult.success ? { inviteError: inviteResult.error } : {})
    };
  }
```

从 body 解构中增加 `inviteCode`：

```typescript
  const { code, fingerprint, inviteCode } = ctx.request.body as { code?: string; fingerprint?: string; inviteCode?: string };
```

- [ ] **Step 3: 新增 GET /api/auth/my-invite-code 路由**

在文件内，`/heartbeat` 路由之后、`export default` 之前添加：

```typescript
router.get('/my-invite-code', async (ctx) => {
  const fingerprint = ctx.query.fingerprint as string;
  if (!fingerprint) {
    ctx.status = 400;
    ctx.body = { success: false, error: '缺少设备指纹' };
    return;
  }
  const db = (await import('../services/AuthDatabase')).getDb();
  const row = db.prepare(
    "SELECT code FROM activation_codes WHERE type = 'invite' AND created_by = ?"
  ).get(fingerprint) as { code: string } | undefined;
  ctx.body = { success: true, code: row?.code || null };
});
```

- [ ] **Step 4: 编译验证**

```bash
cd D:\SLG\server-auth && npx tsc
```

预期：编译成功。

- [ ] **Step 5: 提交**

```bash
cd D:\SLG
git add server-auth/routes/auth.ts server-auth/dist/
git commit -m "feat: add /my-invite-code route and inviteCode param to activate"
```

---

### Task 4: 客户端 LicenseService — 传递 inviteCode

**Files:**
- Modify: `core/license/LicenseService.ts`
- Modify: `core/license/types.ts`

- [ ] **Step 1: 修改 types.ts**

在 `D:\SLG\core\license\types.ts` 中，给 `ActivationResult` 接口添加字段：

```typescript
export interface ActivationResult {
  success: boolean;
  expiresAt?: number;
  error?: string;
  renewType?: string;
  inviteBonus?: boolean;          // 新增
  inviteError?: string;           // 新增
  inviterBonusDays?: number;      // 新增
  inviteeBonusDays?: number;      // 新增
}
```

- [ ] **Step 2: 修改 LicenseService.activate()**

将方法签名改为接受 `inviteCode`：

```typescript
  async activate(activationCode: string, inviteCode?: string): Promise<ActivationResult> {
```

在所有 `fetch` 调用中，body 增加 `inviteCode`：

```typescript
        body: JSON.stringify({ code: activationCode, fingerprint, inviteCode })
```

注意：测试码的分支不需要传 `inviteCode`（它们只用于本地测试），仅在 `try` 块中的网络请求传。

- [ ] **Step 3: 编译验证**

```bash
cd D:\SLG && npx tsc --noEmit
```

预期：无类型错误。

- [ ] **Step 4: 提交**

```bash
cd D:\SLG
git add core/license/LicenseService.ts core/license/types.ts
git commit -m "feat: pass inviteCode through LicenseService.activate"
```

---

### Task 5: 前端 — Activation.tsx 邀请码输入

**Files:**
- Modify: `web/src/pages/Activation.tsx`
- Modify: `web/src/contexts/LicenseContext.tsx`

- [ ] **Step 1: 修改 LicenseContext — activate 方法接受 inviteCode**

在 `D:\SLG\web\src\contexts\LicenseContext.tsx` 中，修改 `activate` 签名：

```typescript
  activate: (code: string, inviteCode?: string) => Promise<{ success: boolean; inviteBonus?: boolean; inviteError?: string; inviterBonusDays?: number; inviteeBonusDays?: number; error?: string }>;
```

在实现中传递给 `licenseService.activate`：

```typescript
  const activate = useCallback(async (code: string, inviteCode?: string) => {
    // ... existing loading/setLoading logic ...
    const result = await licenseService.activate(code, inviteCode);
    // ... pass result through ...
  }, []);
```

- [ ] **Step 2: 修改 Activation.tsx — 添加邀请码输入框**

添加 state：

```typescript
  const [inviteCode, setInviteCode] = useState('');
  const [inviteResult, setInviteResult] = useState<{ success: boolean; inviterBonusDays?: number; inviteeBonusDays?: number; error?: string } | null>(null);
```

修改 `handleSubmit`：

```typescript
  const result = await activate(code.trim(), inviteCode.trim() || undefined);
  if (result.success) {
    setSuccess(true);
    if (result.inviteBonus) {
      setInviteResult({ success: true, inviterBonusDays: result.inviterBonusDays, inviteeBonusDays: result.inviteeBonusDays });
    }
    if (result.inviteError) {
      setInviteResult({ success: false, error: result.inviteError });
    }
  }
```

在激活码输入框下方增加邀请码输入框：

```tsx
            <div className="mb-4">
              <label className="block text-sm font-medium text-slate-700 mb-2">
                邀请码（选填）
              </label>
              <input
                type="text"
                value={inviteCode}
                onChange={(e) => setInviteCode(e.target.value)}
                placeholder="如有邀请码，请输入"
                className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl text-slate-800 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-transparent transition-all"
                disabled={loading}
              />
            </div>
```

在错误提示区域之后添加邀请成功提示：

```tsx
            {inviteResult?.success && (
              <div className="mb-4 p-3 bg-emerald-50 border border-emerald-300 rounded-xl text-emerald-700 text-sm">
                邀请奖励已发放！你和邀请人各获得 {inviteResult.inviteeBonusDays} 天
              </div>
            )}
            {inviteResult && !inviteResult.success && (
              <div className="mb-4 p-3 bg-amber-50 border border-amber-300 rounded-xl text-amber-700 text-sm">
                {inviteResult.error}
              </div>
            )}
```

- [ ] **Step 3: 前端编译验证**

```bash
cd D:\SLG\web && npx tsc --noEmit
```

- [ ] **Step 4: 提交**

```bash
cd D:\SLG
git add web/src/pages/Activation.tsx web/src/contexts/LicenseContext.tsx
git commit -m "feat: add invite code input to activation page"
```

---

### Task 6: 前端 — App.tsx 邀请入口弹窗

**Files:**
- Modify: `web/src/App.tsx`

- [ ] **Step 1: 添加邀请弹窗组件**

在 `NavBar` 函数内部（`appVersion` state 之后）添加：

```typescript
  const [showInvite, setShowInvite] = useState(false);
  const [inviteCode, setInviteCode] = useState('');
  const [copyText, setCopyText] = useState('复制');

  const loadInviteCode = async () => {
    // 从激活状态中获取设备指纹，调用 API
    if (status?.deviceFingerprint) {
      try {
        const res = await fetch(`http://106.15.11.158:3456/api/auth/my-invite-code?fingerprint=${status.deviceFingerprint}`);
        const data = await res.json();
        if (data.success && data.code) setInviteCode(data.code);
      } catch {}
    }
  };
```

在 NavBar 的 license status 区域附近添加按钮：

```tsx
{status?.activated && (
  <button onClick={() => { loadInviteCode(); setShowInvite(true); }}
    className="text-sm text-amber-600 hover:text-amber-500 px-3 py-1.5 rounded hover:bg-amber-50 transition-colors"
    style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}>
    邀请好友
  </button>
)}
```

在 `</nav>` 后添加弹窗：

```tsx
{showInvite && (
  <div className="fixed inset-0 bg-black/30 flex items-center justify-center z-50" onClick={() => setShowInvite(false)}>
    <div className="bg-white rounded-2xl shadow-2xl p-8 max-w-sm w-full mx-4" onClick={e => e.stopPropagation()}>
      <h2 className="text-xl font-bold text-slate-800 mb-2">邀请好友</h2>
      <p className="text-sm text-slate-500 mb-4">你和好友各获得 3 天免费使用</p>
      <div className="flex items-center gap-2 mb-4">
        <input readOnly value={inviteCode || '加载中...'} className="flex-1 px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl font-mono text-sm text-slate-700" />
        <button onClick={() => { navigator.clipboard.writeText(inviteCode); setCopyText('已复制'); setTimeout(() => setCopyText('复制'), 2000); }}
          className="px-4 py-3 bg-emerald-500 hover:bg-emerald-600 text-white rounded-xl text-sm font-medium transition-colors">
          {copyText}
        </button>
      </div>
      <button onClick={() => setShowInvite(false)}
        className="w-full py-2 bg-slate-100 hover:bg-slate-200 rounded-xl text-sm text-slate-600 transition-colors">
        关闭
      </button>
    </div>
  </div>
)}
```

- [ ] **Step 2: 前端编译验证**

```bash
cd D:\SLG\web && npx tsc --noEmit
```

- [ ] **Step 3: 提交**

```bash
cd D:\SLG
git add web/src/App.tsx
git commit -m "feat: add invite friend button and modal with copy"
```

---

### Task 7: 构建 + 部署 + 验证

- [ ] **Step 1: 编译 server-auth**

```bash
cd D:\SLG\server-auth && npx tsc
```

- [ ] **Step 2: 编译 web**

```bash
cd D:\SLG\web && npx vite build
```

- [ ] **Step 3: 部署到 VPS**

```bash
scp -r D:\SLG\server-auth\dist\* root@106.15.11.158:/root/server-auth/dist/
scp D:\SLG\server-auth\package.json root@106.15.11.158:/root/server-auth/
```

- [ ] **Step 4: VPS 重启 + git commit**

```bash
ssh root@106.15.11.158 "cd /root/server-auth && git add -A && git commit -m 'v1.0.2: 邀请码系统' && pm2 restart slg-auth"
```

- [ ] **Step 5: 验证 — 检查 /health**

```bash
curl http://106.15.11.158:3456/health
```

- [ ] **Step 6: 验证 — 测试邀请码接口**

先用 DEMO 码激活一个设备，获取邀请码：
```bash
curl "http://106.15.11.158:3456/api/auth/my-invite-code?fingerprint=<demo-device-fp>"
```

- [ ] **Step 7: 最终提交**

```bash
cd D:\SLG && git status
# 确认无未提交变更
```
