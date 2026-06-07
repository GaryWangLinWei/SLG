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

## 打包

```bash
npm run electron:build:win   # 构建 Windows exe 安装包
```

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
- **`core/`** — 框架无关的核心引擎。设备抽象层（ADB）、图像识别（Vision，模板匹配 + 像素对比）、OCR 服务（tesseract.js）、插件运行时（PluginManager、PluginContext）、许可证客户端（license/）。不包含任何游戏相关逻辑。
- **`plugins/rok/`** — 万国觉醒专属。所有 action、图像模板、位置检测。所有游戏坐标和 UI 知识集中在此。
- **`server/`** — Koa REST API 入口（`server/index.ts`）。通过 `PluginService` 注册插件，暴露设备/插件/任务/账号/许可证/配置接口，将插件的 `console.log` 捕获为任务日志。

**独立项目：**
- **`server-auth/`** — 云端授权服务（Koa + SQLite），部署在独立 VPS。管理激活码 CRUD、设备绑定、心跳验证。提供 `/api/auth/*` 公开 API 和 `/api/admin/*` 管理 API（admin key 鉴权）。Docker 部署。
- **`electron/`** — Electron 桌面应用入口。`main.ts` 管理窗口生命周期、系统托盘、开机自启、自动更新。preload 桥接渲染进程与主进程。

**前端状态管理（React Context）：**
- `LicenseContext` — 许可证状态，激活/预览/取消激活/心跳刷新
- `AccountContext` — 多账号列表 + 当前选中账号（持久化到 localStorage）

## 插件系统

插件在 `server/services/PluginService.ts` 中通过 `ALL_PLUGINS` 数组注册。

**action 定义：** `{ id, name, description, run(ctx, params?) }`。`PluginContext`（即 `ctx`）向每个 action 注入完整的设备/Vision/OCR API，详见 `core/plugin/PluginContext.ts`（`tap`、`sleep`、`findImage`、`findImageWithLocation`、`findAllImages`、`tapImage`、`swipe`、`captureRegion`、`checkButtonStateChange`、`detectState`、`getConfig`、`log`）。

**action 执行链路：** 前端 → `POST /api/tasks` → `TaskService.createTask()` → `POST /api/tasks/:id/run` → `TaskService.runTask()` → `PluginManager.runAction()` → `action.run(ctx, params)`。

**任务取消机制：** `stopTask()` 设置 `stopRequested` 并调用 abort。PluginContext 中每次 `tap`/`sleep` 前都会检查 `checkStop` 回调，循环 action 可被中断。

**TaskService 按账号锁：** 同一账号同时只能运行一个任务（通过 `runningTasks` Map 按 accountId 互斥）。

## HomeFeatures（功能开关）

`plugins/rok/homeFeatures.ts` — 定义首⻚所有功能开关的 TypeScript 接口和默认值。前端持久化到 localStorage，后端不存储。接口包含了城寨集结相关设置（`autoRallyFort`、`rallyFortLevel`、`rallyFortTeam`、`rallyFortDowngrade`）。城寨 CD 不在前端设置，由前端根据任务日志中的执行结果自动判断：成功 10 分钟，失败 2 分钟。

## Vision 图像识别

`core/vision/Vision.ts` — 纯 TypeScript 像素级模板匹配，依赖 `sharp`，无 OpenCV 依赖。

- `findImage(screenshot, template, threshold)` — 两阶段扫描（粗扫 + 精扫），返回 `{found, confidence, location, rect}`
- `findAllImages(screenshot, template, threshold, searchRegion?, scales?)` — 查找区域内所有匹配实例，返回 `{x, y, confidence}[]`。支持多尺度搜索（如 `[0.7, 0.8, 0.9, 1.0, 1.1]`）
- `findAllImagesMultiTemplate(templates[], threshold, searchRegion?, scales?)` — 多模板去重搜索，保留置信度最高的匹配
- `compareImages(path1, path2)` — 像素差异百分比，用于状态变化检测
- **透明 PNG 处理：** Alpha 通道 ≥ 128 的像素参与匹配，< 128 的跳过。阈值匹配：像素差值 > 48 算不匹配
- PluginContext 封装了这些方法：`findImageWithLocation()` 自动截图 → 存临时文件 → 匹配 → 清理

## OCR 服务

`core/ocr/OcrService.ts` — 基于 tesseract.js 的 OCR 单例服务，懒加载 worker。

- `readText(imagePath)` — 英文/数字识别
- `readDigits(imagePath)` — 数字识别（自动灰度化 → 3x 放大 → 二值化预处理，限制只识别 0-9）
- `readChineseText(imagePath)` — 中文识别
- `parseCountdown(text)` — `core/ocr/parseCountdown.ts`，从 OCR 文本中解析时长（如 "1h 23m"）

**常用场景：** 截取小区域 → OCR 读队伍数（如 "2/4"）、读队列剩余时间。

## 配置系统

`server/services/ConfigService.ts` — 按账号的多配置方案存储。

- 每个账号最多 5 个命名配置方案（`MAX_PROFILES = 5`）
- 存储路径：`~/.slg-automation/configs/{accountId}.json`
- 加载时 `deepMerge` 到 `DEFAULT_ROK_CONFIG`，buildingPositions 全量替换，resources 强制使用默认值
- API：`/api/config/rok/*` — 增删改查、切换、重命名配置方案
- 前端通过 `api.config.*` 调用

## 资源路径

`core/resourcePath.ts` — 模板和训练数据目录解析。

- `getTemplatesDir()` — 返回模板图片目录。Electron 打包模式下通过 `initResourcePaths()` 注入，开发模式下回退到 `__dirname`
- `getTraineddataDir()` — 返回 tesseract 训练数据目录
- 开发环境模板路径：`plugins/rok/templates/`

## 反检测措施

`AdbDevice`（`core/device/AdbDevice.ts`）内置随机化：

- **点击偏移：** `tapOffset` 默认 7px，实际点击坐标 ±7px 随机偏移
- **休眠抖动：** `sleepJitter` 默认 0.15，sleep 时间增加 0~15% 随机量
- **滑动曲线化：** `swipe` 使用贝塞尔曲线生成中间点，非直线滑动
- **微停顿：** `PluginContext` 在每个操作之间自动插入极短随机延迟
- `RandomizationConfig` 可开关，通过 `AdbDevice.setRandomization(config)` 调整

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

## 关键设计模式

- **`detectState()`** — 截取屏幕区域，与多张参考模板逐一对比，返回差异最小的那个状态（用于 `getCurrentLocation()` 判断城内/城外）
- **`checkButtonStateChange()`** — 点击按钮前后各截一次图，返回像素变化百分比。变化 = 按钮生效，无变化 = 操作失败（如队伍已满、按钮不可用）
- **`ensureInWorld()` / `ensureInCity()`** — 通过 `detectState()` 检测当前位置，自动点击世界/城内按钮切换
- **OCR 预检模式** — gatherResources 和 rallyFort 在执行前先 OCR 检测空闲队伍数，无空闲则跳过本轮
- **轮询式取消** — `checkStop` 回调在每个阻塞操作前检查，不是信号式中断
- **单例服务** — `DeviceService`、`PluginService`、`TaskService`、`LicenseService`、`ConfigService`、`ocrService` 均为模块级单例
- **console 劫持** — `TaskService.runTask()` 临时替换 `console.log` 将插件输出导入任务日志

## ROK 插件坐标

万国觉醒插件使用硬编码的 1600x900 坐标。`DEFAULT_ROK_CONFIG` 包含所有建筑位置、资源采集偏移量、采集类型按钮位置、城寨搜索按钮位置、科技研究滑动范围等。不同分辨率需重新校准。

图像模板存放在 `plugins/rok/templates/`，通过 `getTemplatesDir()` 加载（不要直接拼接 `__dirname`）。

## 重要文件路径

| 用途 | 路径 |
|------|------|
| 后端入口 | `server/index.ts` |
| 服务端配置 | `server/config.ts` |
| 插件注册 | `server/services/PluginService.ts` |
| 许可证守卫中间件 | `server/middleware/licenseGuard.ts` |
| 配置存储服务 | `server/services/ConfigService.ts` |
| ROK 插件 + 配置 | `plugins/rok/index.ts` |
| ROK action | `plugins/rok/actions/*.ts` |
| ROK 功能开关 | `plugins/rok/homeFeatures.ts` |
| ROK 位置检测 | `plugins/rok/utils/location.ts` |
| ROK 模板图片 | `plugins/rok/templates/` |
| OCR 服务 | `core/ocr/OcrService.ts` |
| 许可证客户端模块 | `core/license/LicenseService.ts` |
| 设备指纹 | `core/license/DeviceFingerprint.ts` |
| 许可证加密存储 | `core/license/LicenseStorage.ts` |
| 资源路径解析 | `core/resourcePath.ts` |
| 前端 API 客户端 | `web/src/api/client.ts` |
| 首页（主控制面板） | `web/src/pages/Home.tsx` |
| 激活页面 | `web/src/pages/Activation.tsx` |
| 配置管理页面 | `web/src/pages/Config.tsx` |
| 前端代理配置 | `web/vite.config.ts` |
| ADB 可执行文件 | `tools/platform-tools/platform-tools/adb.exe` |
| 产品规格说明书 | `docs/SPEC.md` |
| 云端授权服务 | `server-auth/` |
| Electron 入口 | `electron/main.ts` |
| 测试截图 | `temp/` |