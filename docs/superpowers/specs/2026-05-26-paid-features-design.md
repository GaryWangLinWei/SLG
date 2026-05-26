# Paid Features — Design Spec

**Date:** 2026-05-26
**Status:** Approved

## Goal

为 ROK助手 实现商业化自助售卖：管理员在 server-auth 后台批量生成激活码并导出 CSV → 导入独角数卡（发卡平台）→ 用户在线支付后自动获得激活码 → 在 ROK助手客户端激活使用。

## Architecture

```
用户浏览器 → 独角数卡(Docker, :80) → 微信/支付宝支付
                ↑ CSV 导入激活码
管理员浏览器 → server-auth(Docker, :3456) → 生成/导出激活码
                ↑ HTTP 验证
ROK助手客户端 → server-auth → 激活码验证/设备绑定
```

两个 Docker 容器部署在同一台 Linux VPS，互不依赖，通过 CSV 文件桥接。

## Components

### 1. server-auth — CSV 导出 API

**文件:** `server-auth/routes/admin.ts`

新增端点：

```
POST /api/admin/codes/export
  x-admin-key: <admin_key>
  body: { ids?: number[] }   // 可选，不传则导出全部未使用的码

  → Content-Type: text/csv
  → Body: CSV 文本（独角数卡兼容格式）
```

CSV 格式（独角数卡标准导入格式）：

```csv
code,status
A1B2C3D4E5F6G7H8,unused
X9Y8Z7W6V5U4T3S2,unused
```

**实现要点：**
- `ids` 参数可选：传了导出指定 ID 的码，不传导出所有未使用的码
- 导出 `status: 'unused'` 的码
- 生成成功后，码状态改为 `status: 'exported'`（新增状态），防止重复导出
- CSV 不需要 header 也行（独角数卡支持无 header 导入）

### 2. server-auth — 管理面板 UI 改进

**文件:** `server-auth/admin/index.html` + `admin.js`

- 激活码列表每行加 checkbox
- 表格上方加「全部选中」和「导出 CSV」按钮
- 点击导出 → 调用 `/api/admin/codes/export` → 浏览器下载 CSV 文件

### 3. 独角数卡 — Docker 部署

**目录:** `dujiaoka/`（新建，与 server-auth 同级）

使用独角数卡官方 Docker 镜像，`docker-compose.yml` 包含：
- Nginx + PHP（独角数卡应用）
- MySQL 数据库
- 持久化卷挂载

**环境变量（`.env`）：**
- 数据库密码
- 支付商户密钥（微信/支付宝）
- 域名（如有）

**关键配置步骤：**
1. VPS 上执行 `docker compose up -d`
2. 浏览器访问 `http://<VPS_IP>` 完成安装向导
3. 后台配置支付参数
4. 创建商品（按月/季/年定价）
5. 导入 server-auth 导出的 CSV 到对应商品

### 4. 售卖流程

```
管理员操作：
  1. 登录 server-auth 管理面板
  2. 设置数量和有效期 → 生成激活码
  3. 勾选码 → 导出 CSV
  4. 登录独角数卡后台 → 导入 CSV 到商品

用户操作：
  1. 访问独角数卡页面 → 选套餐 → 扫码支付
  2. 支付成功 → 页面自动显示激活码
  3. 打开 ROK助手 → 输入激活码 → 激活成功
```

## Integration Flow

```
server-auth admin          dujiaoka admin        ROK助手 Client
     │                         │                      │
     ├─ 生成激活码              │                      │
     ├─ 导出 CSV ──────────────►│                      │
     │                    ├─ 导入 CSV                 │
     │                    ├─ 创建商品                │
     │                         │                      │
     │                    ┌────┤ (用户购买)            │
     │                    │ 自动发货激活码 │            │
     │                    └────┘                      │
     │                         │                      │
     │                         │  用户输入激活码 ──────►│
     │◄────────────────────────── POST /api/auth/activate
     │──────────────────────────► 验证成功
```

## Data Flow

**CSV 导出：**
```
GET /api/admin/codes → 筛选 unused → 格式化为 CSV → 浏览器下载
```

**激活验证（不变）：**
```
POST /api/auth/activate { code, fingerprint }
→ ActivationCodeService.useCode()
→ 检查 status (unused/exported → 可用)
→ 绑定设备 → 返回 token + expiresAt
```

## Error Handling

- CSV 导出时无码可选 → 返回空 CSV，提示"无可用激活码"
- 独角数卡导入失败 → 检查 CSV 编码（UTF-8 BOM），独角数卡要求 UTF-8
- 已导出但未售出的码 → `status: 'exported'` 可被重新导出或吊销
- 独角数卡服务挂了不影响 server-auth 运行

## 涉及文件

| 文件 | 改动 |
|------|------|
| `server-auth/routes/admin.ts` | 新增 `/codes/export` 端点 |
| `server-auth/services/ActivationCodeService.ts` | `getAllCodes` 支持 `status` 过滤；`useCode` 接受 `exported` 状态 |
| `server-auth/admin/index.html` | 加 checkbox 和导出按钮 |
| `server-auth/admin/admin.js` | 导出 CSV 逻辑 |
| `dujiaoka/docker-compose.yml` | 新建，独角数卡部署 |
| `dujiaoka/.env` | 新建，环境变量配置 |

## 非代码事项

- VPS 安全组开放 80 端口（独角数卡）
- 申请微信支付商户号或码支付账号
- 如有域名，DNS 解析到 VPS IP 并备案（微信支付要求）
- 独角数卡后台配置 SMTP（可选，用于邮件通知）
