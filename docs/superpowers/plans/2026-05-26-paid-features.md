# Paid Features Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为 server-auth 新增激活码 CSV 导出功能 + admin 面板操作 UI + 独角数卡 Docker 部署配置，实现自助售卖。

**Architecture:** server-auth admin 面板批量生成激活码 → CSV 导出 → 导入独角数卡后台 → 用户扫码支付自动发货 → ROK助手客户端激活。

**Tech Stack:** Koa router, SQLite, vanilla JS admin panel, Docker Compose (独角数卡)

---

### Task 1: ActivationCodeService — 扩展查询与验证

**Files:**
- Modify: `server-auth/services/ActivationCodeService.ts`

- [ ] **Step 1: getAllCodes 支持 status 过滤**

当前 `getAllCodes(limit, offset)` 返回所有码。添加可选 `status` 参数：

```typescript
export function getAllCodes(limit: number = 100, offset: number = 0, status?: string): ActivationCode[] {
  const db = getDb();
  if (status) {
    return db.prepare('SELECT * FROM activation_codes WHERE status = ? ORDER BY created_at DESC LIMIT ? OFFSET ?')
      .all(status, limit, offset) as ActivationCode[];
  }
  return db.prepare('SELECT * FROM activation_codes ORDER BY created_at DESC LIMIT ? OFFSET ?').all(limit, offset) as ActivationCode[];
}
```

- [ ] **Step 2: useCode 接受 `exported` 状态**

当前 `useCode` 检测 `status === 'unused'` 才允许首次激活。`exported` 状态的码也应该可以激活。修改第 102 行附近的条件判断逻辑：

在第 71-73 行（检测 status === 'revoked' 之后），修改 `status === 'used'` 判断为同时处理 exported：

```typescript
if (activationCode.status === 'revoked') {
  return { success: false, error: '激活码已被吊销' };
}

// 'unused' 和 'exported' 都是可用状态
if (activationCode.status === 'used') {
  // ... 已使用的续费逻辑保持不变
}
```

具体修改：将第 79 行的 `if (activationCode.status === 'used')` 上面的「首次激活」分支（第 103 行起）也接受 `activationCode.status === 'exported'`：

实际上逻辑已经正确——`revoked` 和 `used` 已单独处理，剩下的 `unused` 和 `exported` 都会落入首次激活分支。只需确认 `status === 'used'` 判断（第 79 行）对 `exported` 不会误拦截。

`exported` 状态码的逻辑路径：
1. `getCode(code)` 查到
2. `status === 'revoked'` → 否
3. `status === 'used'` → 否（它是 exported）
4. 首次激活分支 → **正确激活**

现有代码已兼容，无需改动 `useCode` 逻辑。

- [ ] **Step 3: 新增 exportCodes 函数 + getCodesByIds 辅助**

在文件末尾添加：

```typescript
// 获取指定 ID 的激活码
export function getCodesByIds(ids: number[]): ActivationCode[] {
  const db = getDb();
  const placeholders = ids.map(() => '?').join(',');
  return db.prepare(`SELECT * FROM activation_codes WHERE id IN (${placeholders})`).all(...ids) as ActivationCode[];
}

// 导出激活码为 CSV（独角数卡兼容格式）
export function exportCodes(ids?: number[]): string {
  const db = getDb();
  let rows: ActivationCode[];

  if (ids && ids.length > 0) {
    rows = getCodesByIds(ids).filter(c => c.status === 'unused');
  } else {
    rows = db.prepare("SELECT * FROM activation_codes WHERE status = 'unused' ORDER BY created_at DESC").all() as ActivationCode[];
  }

  // 标记为 exported
  const update = db.prepare('UPDATE activation_codes SET status = ? WHERE id = ?');
  const transaction = db.transaction(() => {
    for (const row of rows) {
      update.run('exported', row.id);
    }
  });
  transaction();

  // 生成 CSV（独角数卡格式：code,status）
  const csvLines = ['code,status'];
  for (const row of rows) {
    csvLines.push(`${row.code},unused`);
  }
  return csvLines.join('\n');
}
```

- [ ] **Step 4: 验证编译**

Run: `cd D:/SLG/server-auth && npx tsc --noEmit`
Expected: 无错误。

- [ ] **Step 5: Commit**

```bash
git add server-auth/services/ActivationCodeService.ts
git commit -m "feat: add CSV export and status filter to ActivationCodeService"
```

---

### Task 2: admin routes — 新增 CSV 导出端点

**Files:**
- Modify: `server-auth/routes/admin.ts`

- [ ] **Step 1: 在 admin.ts 中添加 export 路由**

在 `/codes/generate` 路由之后、`/codes/preview` 之前添加：

```typescript
// 导出激活码为 CSV（独角数卡兼容格式）
router.post('/codes/export', async (ctx) => {
  const { ids } = ctx.request.body as { ids?: number[] };

  const { exportCodes } = await import('../services/ActivationCodeService');
  const csv = exportCodes(ids);

  ctx.set('Content-Type', 'text/csv; charset=utf-8');
  ctx.set('Content-Disposition', 'attachment; filename="activation-codes.csv"');
  ctx.body = '﻿' + csv; // UTF-8 BOM，确保 Excel 正确识别中文
});
```

- [ ] **Step 2: 更新 getCodes 端点支持 status 过滤**

修改现有 `router.get('/codes', ...)` 处理函数，传递 `status` 查询参数：

```typescript
router.get('/codes', async (ctx) => {
  const limit = parseInt(ctx.query.limit as string) || 100;
  const offset = parseInt(ctx.query.offset as string) || 0;
  const status = ctx.query.status as string | undefined;

  ctx.body = {
    success: true,
    codes: getAllCodes(limit, offset, status)
  };
});
```

- [ ] **Step 3: 验证编译**

Run: `cd D:/SLG/server-auth && npx tsc --noEmit`
Expected: 无错误。

- [ ] **Step 4: Commit**

```bash
git add server-auth/routes/admin.ts
git commit -m "feat: add CSV export endpoint and status filter to admin codes route"
```

---

### Task 3: Admin 面板 — CSV 导出 UI

**Files:**
- Modify: `server-auth/admin/index.html`
- Modify: `server-auth/admin/admin.js`
- Modify: `server-auth/admin/admin.css`

- [ ] **Step 1: index.html — 加工具栏和 checkbox**

在激活码列表卡片中，table 上方添加工具栏；thead 第一列添加 checkbox 列。修改 `index.html` 中激活码列表的 `<div class="card">` 部分：

找到 `<div class="card"><h2>激活码列表</h2>`，在其后、`<div class="table-container">` 之前插入：

```html
<div class="toolbar">
  <button id="selectAllBtn" class="btn btn-sm btn-secondary">全选 unused</button>
  <button id="deselectAllBtn" class="btn btn-sm btn-secondary">取消全选</button>
  <button id="exportBtn" class="btn btn-sm" style="background:#22c55e;color:#fff;">导出 CSV</button>
</div>
```

修改 `<thead>` 第一行为：

```html
<thead>
  <tr>
    <th style="width:40px;"><input type="checkbox" id="selectAllCheckbox"></th>
    <th>激活码</th>
    <th>有效期</th>
    <th>状态</th>
    <th>创建时间</th>
    <th>操作</th>
  </tr>
</thead>
```

- [ ] **Step 2: admin.js — 表格渲染加 checkbox**

修改 `loadCodes()` 函数中 tbody 渲染，每行第一列加 checkbox：

```javascript
async function loadCodes() {
  try {
    const data = await apiRequest('/api/admin/codes');
    const tbody = document.getElementById('codesTable');
    tbody.innerHTML = data.codes.map(code => `
      <tr>
        <td>${code.status === 'unused' ? `<input type="checkbox" class="code-checkbox" data-id="${code.id}" data-code="${code.code}">` : ''}</td>
        <td><code>${code.code}</code></td>
        <td>${code.duration_days}天</td>
        <td><span class="status status-${code.status}">${renderStatus(code.status)}</span></td>
        <td>${formatDate(code.created_at)}</td>
        <td>
          ${code.status !== 'revoked' ? `<button class="btn btn-danger revoke-btn" data-id="${code.id}">吊销</button>` : '-'}
        </td>
      </tr>
    `).join('');

    // ... 吊销按钮事件绑定保持不变
  } catch (e) {
    console.error('Failed to load codes:', e);
  }
}

function renderStatus(status) {
  const map = { unused: '未使用', used: '已使用', revoked: '已吊销', exported: '已导出' };
  return map[status] || status;
}
```

- [ ] **Step 3: admin.js — 全选 / 导出逻辑**

在文件末尾添加：

```javascript
// 全选 unused 的 checkbox
document.getElementById('selectAllCheckbox').addEventListener('change', function () {
  document.querySelectorAll('.code-checkbox').forEach(cb => { cb.checked = this.checked; });
});

document.getElementById('selectAllBtn').addEventListener('click', () => {
  document.querySelectorAll('.code-checkbox').forEach(cb => { cb.checked = true; });
  document.getElementById('selectAllCheckbox').checked = true;
});

document.getElementById('deselectAllBtn').addEventListener('click', () => {
  document.querySelectorAll('.code-checkbox').forEach(cb => { cb.checked = false; });
  document.getElementById('selectAllCheckbox').checked = false;
});

// 导出 CSV
document.getElementById('exportBtn').addEventListener('click', async () => {
  const checked = document.querySelectorAll('.code-checkbox:checked');
  const ids = Array.from(checked).map(cb => parseInt(cb.dataset.id));

  try {
    const response = await fetch(`${API_BASE}/api/admin/codes/export`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Admin-Key': adminKey },
      body: JSON.stringify(ids.length > 0 ? { ids } : {})
    });

    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      throw new Error(err.error || '导出失败');
    }

    const blob = await response.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'activation-codes.csv';
    a.click();
    URL.revokeObjectURL(url);

    loadCodes();
    loadStats();
  } catch (e) {
    alert('导出失败: ' + e.message);
  }
});
```

- [ ] **Step 4: admin.css — 工具栏样式 + status badge**

在 CSS 末尾添加：

```css
.toolbar {
  display: flex;
  gap: 10px;
  margin-bottom: 16px;
  align-items: center;
}

.btn-sm {
  padding: 8px 16px;
  font-size: 13px;
}

.status-exported {
  background: rgba(250, 204, 21, 0.2);
  color: #fde68a;
}

/* Checkbox */
#selectAllCheckbox,
.code-checkbox {
  width: 16px;
  height: 16px;
  cursor: pointer;
  accent-color: #22c55e;
}
```

- [ ] **Step 5: 验证**

Run: `cd D:/SLG/server-auth && npx tsc --noEmit`
Expected: 无错误。

启动 server-auth: `npm run dev`，浏览器打开 admin 面板，验证：
- 激活码行有 checkbox
- 全选/取消全选生效
- 导出 CSV 文件下载成功，内容是独角数卡格式

- [ ] **Step 6: Commit**

```bash
git add server-auth/admin/index.html server-auth/admin/admin.js server-auth/admin/admin.css
git commit -m "feat: add CSV export UI with checkboxes and select-all to admin panel"
```

---

### Task 4: 独角数卡 — Docker 部署配置

**Files:**
- Create: `dujiaoka/docker-compose.yml`
- Create: `dujiaoka/.env.example`

- [ ] **Step 1: 创建 dujiaoka/docker-compose.yml**

```yaml
version: "3.8"

services:
  dujiaoka:
    image: dujiaoka/dujiaoka:latest
    container_name: dujiaoka
    ports:
      - "80:80"
    volumes:
      - ./storage:/app/storage
      - ./.env:/app/.env
    depends_on:
      - dujiaoka-db
    restart: unless-stopped

  dujiaoka-db:
    image: mysql:8.0
    container_name: dujiaoka-db
    environment:
      MYSQL_ROOT_PASSWORD: ${DB_ROOT_PASSWORD:-rootpass}
      MYSQL_DATABASE: dujiaoka
      MYSQL_USER: dujiaoka
      MYSQL_PASSWORD: ${DB_PASSWORD:-dujiaoka}
    volumes:
      - ./mysql:/var/lib/mysql
    restart: unless-stopped
```

- [ ] **Step 2: 创建 dujiaoka/.env.example**

```
APP_URL=http://你的VPS_IP

DB_HOST=dujiaoka-db
DB_DATABASE=dujiaoka
DB_USERNAME=dujiaoka
DB_PASSWORD=自行设置的数据库密码

DB_ROOT_PASSWORD=自行设置的root密码
```

- [ ] **Step 3: Commit**

```bash
git add dujiaoka/docker-compose.yml dujiaoka/.env.example
git commit -m "feat: add dujiaoka Docker Compose config for self-service code sales"
```

---

### Task 5: 最终验证

- [ ] **Step 1: TypeScript 编译检查**

```bash
cd D:/SLG/server-auth && npx tsc --noEmit
```
Expected: 无错误。

- [ ] **Step 2: admin 面板烟雾测试**

```bash
cd D:/SLG/server-auth && docker compose up -d --build
# 浏览器访问 http://localhost:3456
# 登录 → 生成 5 个测试码 → 勾选 → 导出 CSV → 确认文件内容正确
```

导出 CSV 预期内容：
```csv
code,status
XXXXXXXXX,unused
XXXXXXXXX,unused
XXXXXXXXX,unused
```

- [ ] **Step 3: 独角数卡部署验证**

```bash
cd D:/SLG/dujiaoka
# 复制 .env.example 为 .env，修改数据库密码
cp .env.example .env
docker compose up -d
# 浏览器访问 http://localhost → 确认安装向导页面出现
```

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "chore: final verification of paid features implementation"
```

---

### 部署检查清单（VPS 上线后）

- [ ] VPS 安全组开放 80 端口
- [ ] 独角数卡安装向导完成
- [ ] 支付方式配置（微信/支付宝/码支付）
- [ ] 独角数卡后台创建商品并导入 CSV
- [ ] 端到端测试：访问商店 → 支付 → 获得激活码 → ROK助手激活成功
