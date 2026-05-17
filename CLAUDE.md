# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 启动 / 重启

需要同时运行两个服务，分别在不同终端：

```bash
# 后端（Koa API，端口 3000）
npm run server          # 或 npm run dev（两者等价）

# 前端（Vite 开发服务器，端口 5173，/api 请求代理到 :3000）
cd web && npm run dev
```

**重启前先杀干净所有 node 进程（Windows）：**
```bash
powershell -Command "Get-Process node -ErrorAction SilentlyContinue | Stop-Process -Force"
```

**注意：** `ts-node` 不会热重载 `plugins/` 和 `core/` 目录的改动，每次修改这些目录后必须手动重启后端。

## 测试

```bash
npm test                         # 运行所有测试（core/ 和 plugins/ 目录）
npx jest path/to/file.test.ts    # 运行单个测试文件
```

测试文件与源码放在一起：`**/*.test.ts`。测试根目录：`<rootDir>/core`、`<rootDir>/plugins`。使用 `ts-jest` 预设，Node 环境。

## 架构

```
web/ (React+Vite)  ──/api──▶  server/ (Koa+REST)  ──▶  core/ ──▶  ADB → 模拟器
                                ▲
                        plugins/{rok,slg-common}/
```

**三层分离：**
- **`core/`** — 框架无关的核心引擎。设备抽象层（ADB）、图像识别（Vision，模板匹配 + 像素对比）、插件运行时（PluginManager、PluginContext）、许可证客户端（license/）。不包含任何游戏相关逻辑。
- **`plugins/rok/`** — 万国觉醒专属。所有 action、图像模板、位置检测。所有游戏坐标和 UI 知识集中在此。
- **`server/`** — Koa REST API 入口（`server/index.ts`）。通过 `PluginService` 注册插件，暴露设备/插件/任务/账号/许可证接口，将插件的 `console.log` 捕获为任务日志。

**独立项目：**
- **`server-auth/`** — 云端授权服务（Koa + SQLite），部署在独立 VPS。管理激活码 CRUD、设备绑定、心跳验证。提供 `/api/auth/*` 公开 API 和 `/api/admin/*` 管理 API（admin key 鉴权）。Docker 部署。
- **`electron/`** — Electron 桌面应用入口。`main.ts` 管理窗口生命周期、系统托盘、开机自启、自动更新。preload 桥接渲染进程与主进程。

**前端状态管理（React Context）：**
- `LicenseContext` — 许可证状态，激活/预览/取消激活/心跳刷新
- `AccountContext` — 多账号列表 + 当前选中账号（持久化到 localStorage）

## 插件系统

插件在 `server/services/PluginService.ts` 中通过 `ALL_PLUGINS` 数组注册。

**action 定义：** `{ id, name, description, run(ctx, params?) }`。`PluginContext`（即 `ctx`）向每个 action 注入完整的设备/Vision API，详见 `core/plugin/PluginContext.ts`（`tap`、`sleep`、`findImage`、`findImageWithLocation`、`tapImage`、`swipe`、`captureRegion`、`checkButtonStateChange`、`detectState`、`getConfig`、`log`）。

**action 执行链路：** 前端 → `POST /api/tasks` → `TaskService.createTask()` → `POST /api/tasks/:id/run` → `TaskService.runTask()` → `PluginManager.runAction()` → `action.run(ctx, params)`。

**任务取消机制：** `stopTask()` 设置 `stopRequested` 并调用 abort。PluginContext 中每次 `tap`/`sleep` 前都会检查 `checkStop` 回调，循环 action 可被中断。

## Vision 图像识别

`core/vision/Vision.ts` — 纯 TypeScript 像素级模板匹配，依赖 `sharp`，无 OpenCV 依赖。

- `findImage(screenshot, template, threshold)` — 两阶段扫描（粗扫 + 精扫），返回 `{found, confidence, location, rect}`
- `compareImages(path1, path2)` — 像素差异百分比，用于状态变化检测
- 模板匹配阈值：像素差值 > 48 算不匹配
- PluginContext 封装了这些方法：`findImageWithLocation()` 自动截图 → 存临时文件 → 匹配 → 清理

## 关键设计模式

- **`detectState()`** — 截取屏幕区域，与多张参考模板逐一对比，返回差异最小的那个状态（用于 `getCurrentLocation()` 判断城内/城外）
- **`checkButtonStateChange()`** — 点击按钮前后各截一次图，返回像素变化百分比（用于采集流程中检测队伍按钮是否被成功选中）
- **轮询式取消** — `checkStop` 回调在每个阻塞操作前检查，不是信号式中断
- **单例服务** — `DeviceService`、`PluginService`、`TaskService`、`LicenseService` 均为模块级单例
- **console 劫持** — `TaskService.runTask()` 临时替换 `console.log` 将插件输出导入任务日志

## 授权系统

**按账号计费模式：** 1 个激活码 = N 个账号配额（`maxAccounts`），非 1 对 1 设备绑定。

**许可证存储：** AES-256-GCM 加密，密钥由设备指纹派生（同机器可解密，拷贝无效）。存储路径：`~/.slg-automation/license.json`。

**设备指纹：** SHA256(CPU型号 + 核心数 + 平台 + hostname + 用户名)，截取前 32 字符。

**续费规则：**
- 同级别（same-tier）：时间累加（剩余时间 + 新天数）
- 升级/降级：时间重置（旧剩余时间丢弃），前端先 preview 再 confirm 再 activate

**离线宽限：** 心跳失败后 24 小时内可继续使用。`LicenseService.heartbeat()` 每小时一次。

**licenseGuard 中间件：** 拦截所有 API 请求，放行 `/api/health`、`/api/`、`/api/license/*`。未激活/已到期/离线超时均返回 403。

**测试激活码：**
| 码 | 行为 |
|----|------|
| `DEMO-123456` | 首次激活，30 天，5 账号 |
| `ERROR` | 测试错误显示 |
| `RENEW-SAME` | 同级别续费（时间累加） |
| `RENEW-UP` | 升级到 10 账号（时间重置） |
| `RENEW-DOWN` | 降级到 1 账号（时间重置） |

## ROK 插件坐标

万国觉醒插件使用硬编码的 1080x1920 坐标。`DEFAULT_ROK_CONFIG` 包含所有建筑位置、资源采集偏移量、采集类型按钮位置、科技研究滑动范围等。不同分辨率需重新校准。

图像模板存放在 `plugins/rok/templates/`，通过 `path.join(__dirname, '../templates')` 加载。

## 重要文件路径

| 用途 | 路径 |
|------|------|
| 后端入口 | `server/index.ts` |
| 服务端配置 | `server/config.ts` |
| 插件注册 | `server/services/PluginService.ts` |
| 许可证守卫中间件 | `server/middleware/licenseGuard.ts` |
| ROK 插件 + 配置 | `plugins/rok/index.ts` |
| ROK action | `plugins/rok/actions/*.ts` |
| ROK 位置检测 | `plugins/rok/utils/location.ts` |
| ROK 模板图片 | `plugins/rok/templates/` |
| 许可证客户端模块 | `core/license/LicenseService.ts` |
| 设备指纹 | `core/license/DeviceFingerprint.ts` |
| 许可证加密存储 | `core/license/LicenseStorage.ts` |
| 前端 API 客户端 | `web/src/api/client.ts` |
| 首页（主控制面板） | `web/src/pages/Home.tsx` |
| 激活页面 | `web/src/pages/Activation.tsx` |
| 前端代理配置 | `web/vite.config.ts` |
| ADB 可执行文件 | `tools/platform-tools/platform-tools/adb.exe` |
| 产品规格说明书 | `docs/SPEC.md` |
| 云端授权服务 | `server-auth/` |
| Electron 入口 | `electron/main.ts` |
