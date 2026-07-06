# SLG 助手 - 远程控制功能设计文档

**版本**: v1.0
**日期**: 2026-06-28
**作者**: Claude

---

## 1. 背景与目标

### 1.1 背景

- 现有 Mobile 页面仅支持内网 WiFi 访问
- 用户需要在外网（4G/5G）也能查看运行日志
- 用户需要远程控制任务启停，无需守在电脑前

### 1.2 目标

- ✅ 外网访问：手机任意网络都能查看日志
- ✅ 远程控制：手机上可以启动/停止任务
- ✅ 安全可靠：完善的身份验证，防止未授权访问
- ✅ 低服务器压力：2 核 2GB VPS 可轻松承载 100+ 并发

---

## 2. 系统架构

```
┌─────────────────┐
│   手机浏览器     │  Mobile 页面：看日志 + 发指令
│  (外网/内网)    │
└────────┬────────┘
         │  HTTPS/WebSocket
         ▼
┌─────────────────┐
│   VPS 云端      │  server-auth：身份验证 + 消息路由 + 日志存储
│  (公网 IP)      │
└────────┬────────┘
         │  WebSocket 双向长连接
         ▼
┌─────────────────┐
│  电脑客户端     │  SLG 助手：执行指令 + 推送日志/状态
│  (内网/外网)    │
└─────────────────┘
```

### 2.1 核心设计原则

1. **云端无状态**：只做消息路由和临时存储，不执行业务逻辑
2. **设备智能**：所有业务逻辑仍在电脑客户端执行，云端只透传
3. **降级兼容**：网络断开时自动重连，恢复后补发日志
4. **安全优先**：所有操作都有验证，敏感操作二次确认

---

## 3. 身份验证设计

### 3.1 双层验证机制

| 层级 | 验证方式 | 用途 | 有效期 |
|------|----------|------|--------|
| **设备层** | 激活码 + 设备指纹 | 电脑客户端连接云端 | 长期，心跳续期 |
| **用户层** | 6 位数字验证码 | 手机浏览器访问 | 10 分钟，单次有效 |

### 3.2 验证码生成流程

```
1. 电脑端点击「远程控制」按钮
2. 电脑端 → VPS：POST /api/remote/generate-code { deviceId, activationCode }
3. VPS 生成 6 位随机数字，存入数据库，绑定 deviceId
4. VPS → 电脑端：{ code: "123456", url: "https://你的域名/mobile?code=123456" }
5. 电脑端弹窗显示验证码和二维码
6. 手机扫码/输入验证码 → VPS 验证
7. 验证通过后，建立 WebSocket 连接，返回 session token
8. 验证码标记为已使用，立即失效
```

### 3.3 安全措施

| 措施 | 说明 |
|------|------|
| 验证码 10 分钟过期 | 超过时间自动失效 |
| 单次使用 | 用一次就作废，哪怕没过期 |
| 错误次数限制 | 输错 3 次锁定 1 分钟，防止暴力猜解 |
| HTTPS 加密 | 所有传输都走 HTTPS/WSS |
| 设备绑定 | 验证码只能看对应设备的日志，不能跨设备 |

---

## 4. 消息协议设计

### 4.1 统一消息格式

```typescript
interface WsMessage {
  type: 'log' | 'command' | 'response' | 'status' | 'heartbeat';
  id: string;        // 消息 UUID，用于 request-response 匹配
  deviceId: string;  // 目标/来源设备 ID
  data: any;         // 消息内容
  timestamp: number; // Unix 毫秒时间戳
}
```

### 4.2 消息类型详解

| type | 方向 | data 示例 | 说明 |
|------|------|-----------|------|
| `log` | 电脑 → 云端 → 手机 | `{ message: "✅ 宝石采集完成", level: "info" }` | 日志推送 |
| `command` | 手机 → 云端 → 电脑 | `{ action: "start_task", payload: { task: "gem-gather" } }` | 控制指令 |
| `response` | 电脑 → 云端 → 手机 | `{ requestId: "xxx", success: true, result: "任务已启动" }` | 指令响应 |
| `status` | 电脑 → 云端 → 手机 | `{ online: true, runningTasks: ["gem-gather"], queueLength: 3 }` | 状态同步 |
| `heartbeat` | 双向 | `{}` | 30 秒一次保活 |

### 4.3 消息路由规则

1. 电脑设备连接后注册到 `deviceId → wsConnection` Map
2. 手机用户连接后注册到 `sessionId → wsConnection` Map
3. 手机发 `command` 时，根据 session 绑定的 deviceId 找到对应设备连接，转发消息
4. 设备发 `log`/`response`/`status` 时，找到所有监听该设备的用户连接，广播消息

---

## 5. 服务端（server-auth）改动

### 5.1 新增文件结构

```
server-auth/
├── src/
│   ├── ws/
│   │   ├── WebSocketServer.ts    # WS 服务端，管理所有连接
│   │   ├── DeviceConnection.ts    # 电脑设备连接封装
│   │   └── UserConnection.ts      # 手机用户连接封装
│   ├── services/
│   │   └── RemoteControlService.ts # 消息路由、验证码管理
│   ├── routes/
│   │   └── remote.ts              # HTTP API：验证码、历史日志查询
│   ├── db/
│   │   └── migrations/
│   │       └── 005_remote_control.sql  # 数据库迁移
│   └── index.ts                   # 集成 WS 服务到 Koa
```

### 5.2 数据库表设计

```sql
-- 远程访问验证码
CREATE TABLE remote_codes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT UNIQUE NOT NULL,          -- 6 位数字
  device_id TEXT NOT NULL,            -- 绑定的设备 ID
  activation_code TEXT NOT NULL,      -- 关联的激活码
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  expires_at DATETIME NOT NULL,       -- 10 分钟后过期
  used BOOLEAN DEFAULT 0,
  used_at DATETIME
);

-- 云端日志存储
CREATE TABLE remote_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  device_id TEXT NOT NULL,
  activation_code TEXT NOT NULL,
  message TEXT NOT NULL,
  level TEXT DEFAULT 'info',
  timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- 索引优化查询
CREATE INDEX idx_remote_logs_device ON remote_logs(device_id, timestamp DESC);
CREATE INDEX idx_remote_codes_code ON remote_codes(code);
```

### 5.3 日志自动清理

- 每天凌晨 3 点执行清理任务
- 删除 7 天前的日志
- 每个设备最多保留最近 10000 条日志

### 5.4 HTTP API 端点

```
POST /api/remote/generate-code    # 生成验证码（设备调用）
GET  /api/remote/verify?code=xxx   # 验证验证码（手机调用）
GET  /api/remote/logs?deviceId=xxx&limit=200  # 拉取历史日志
```

---

## 6. 电脑客户端改动

### 6.1 新增文件结构

```
SLG/
├── core/
│   └── remote/
│       ├── RemoteClient.ts         # WebSocket 客户端封装
│       └── CommandHandler.ts       # 指令处理分发
└── plugins/
    └── rok/
        └── actions/
            └── remoteControl.ts     # 远程控制指令具体实现
```

### 6.2 支持的远程指令

| 指令 | 说明 |
|------|------|
| `start_gem_gather` | 启动宝石采集任务 |
| `start_rally_join` | 启动加入集结任务 |
| `start_cave_explore` | 启动山洞探索任务 |
| `start_research_tech` | 启动科技研究 |
| `stop_all_tasks` | 停止所有运行中的任务 |
| `get_status` | 获取当前状态（运行中任务、队列长度） |
| `get_logs` | 获取最近 N 条本地日志 |

### 6.3 日志推送策略

- **实时推送**：每条日志产生后立即推送到云端
- **断线缓存**：网络断开时缓存到内存，重连后批量补发
- **批量优化**：攒够 10 条或超过 1 秒批量推送，减少网络请求
- **压缩**：gzip 压缩后传输，减少带宽消耗

---

## 7. 手机端（Mobile 页面）改动

### 7.1 页面重构（增加 Tab 切换）

```
┌─────────────────────────┐
│  📱 SLG 助手  🟢在线    │
│  💎宝石 123  🏰集结 45   │
├─────────────────────────┤
│  日志  |  控制  |  状态 │  ← Tab 切换栏
├─────────────────────────┤
│                         │
│   日志列表 / 控制面板   │
│                         │
└─────────────────────────┘
```

### 7.2 Tab 功能详情

**「日志」Tab**（现有功能保留）：
- 实时日志流
- 仅看成功过滤
- 自动滚动开关
- 颜色高亮

**「控制」Tab**（新增）：
- 宝石采集：启动/停止按钮
- 加入集结：启动/停止按钮
- 山洞探索：启动/停止按钮
- 科技研究：启动/停止按钮
- 一键停止所有任务按钮
- 每个任务显示当前状态（运行中/空闲）

**「状态」Tab**（新增）：
- 设备在线状态
- 当前运行任务列表
- 任务队列预览
- 今日执行统计
- 最后心跳时间

### 7.3 自动识别内网/外网

- 页面加载时先尝试连接 `localhost:3000`
- 能连上 → 内网模式，直接连接本地后端
- 连不上 → 外网模式，显示验证码输入框

---

## 8. 开发阶段划分

| 阶段 | 内容 | 预估时间 | 验收标准 |
|------|------|----------|----------|
| **阶段 1** | 云端 WebSocket 基础 + 日志推送 + 手机只读查看 | 1~2 天 | 手机外网能看实时日志 |
| **阶段 2** | 指令转发 + 电脑端指令处理 + 验证码机制 | 1 天 | 手机能发指令，电脑能执行 |
| **阶段 3** | 手机控制面板 UI + Tab 切换 + 状态展示 | 1 天 | 手机页面有完整控制功能 |
| **阶段 4** | 测试 + 断线重连 + 安全加固 + 性能优化 | 1 天 | 网络波动不影响，安全无漏洞 |

---

## 9. 服务器资源评估

### 9.1 资源消耗预估（100 人同时在线）

| 资源 | 预估消耗 | 占 2 核 2GB 比例 |
|------|----------|------------------|
| CPU | < 5% | 95% 剩余 |
| 内存 | < 200 MB | 90% 剩余 |
| 带宽 | < 1 Mbps | 充足 |
| 存储（7 天日志） | < 7 GB | 取决于磁盘 |

### 9.2 结论

**2 核 2GB VPS 完全可以承载 500+ 同时在线用户**，远程控制功能对服务器压力极小。

---

## 10. 风险与应对

| 风险 | 应对措施 |
|------|----------|
| VPS 宕机 | 手机端自动降级到内网模式，提示用户连同一 WiFi |
| 网络波动 | 断线自动重连，缓存未发送日志，重连后补发 |
| 验证码泄露 | 10 分钟过期 + 单次使用，即使泄露也很快失效 |
| 恶意攻击 | 频率限制 + 验证码错误次数锁定 + IP 黑名单 |
| 日志太多 | 自动清理 7 天前日志，限制单设备最大日志条数 |

---

## 11. 后续扩展方向

1. **多设备管理**：一个激活码绑定多台电脑，手机可以切换查看
2. **任务定时**：手机上设置定时任务，到点自动执行
3. **推送通知**：任务完成/出错时通过微信/短信推送提醒
4. **截图查看**：手机上可以实时查看当前游戏画面截图
