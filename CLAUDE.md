# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 常用命令

### 本地开发

前后端需要分别启动：

```bash
npm run server          # Koa API，http://localhost:3000
cd web && npm run dev   # Vite，http://localhost:5173；/api 代理到 :3000
```

`npm run dev` 与 `npm run server` 等价。`ts-node` 不会热重载 `core/` 或 `plugins/`；修改这些目录后需手动重启后端。

Windows 上需要清理残留进程时：

```powershell
Get-Process node -ErrorAction SilentlyContinue | Stop-Process -Force
```

### 构建与类型检查

```bash
npm run build                 # 根项目 TypeScript → dist/
cd web && npm run build       # 前端类型检查 + Vite 构建
cd server-auth && npm run build
npm run electron:build:win    # 完整 Windows 安装包 → release/
npm run electron:publish:win  # 构建并发布更新
```

只做根项目类型检查可运行：

```bash
npx tsc --noEmit
```

### 测试

```bash
npm test                                      # 全部 Jest 测试
npx jest plugins/rok/actions/gatherGem.test.ts --runInBand
npx jest path/to/file.test.ts -t "测试名称" --runInBand
```

测试与源码同目录，匹配 `core/**/*.test.ts` 和 `plugins/**/*.test.ts`，使用 Jest + ts-jest。优先运行与改动直接相关的测试；除非修改公共基础模块或明确要求，不要为局部改动主动运行全量测试。部分图像/ONNX 测试会处理 `temp/` 中的真实截图，耗时较长。

根 `npm run lint` 当前指向已不存在的 `src/**/*.ts`，不能作为有效的全仓 lint 命令；不要据此宣称 lint 已通过。

## 系统架构

```text
web/ (React + Vite)
       │ REST /api
       ▼
server/ (Koa) ── TaskService ── PluginManager
                                  │ PluginContext
                                  ▼
plugins/rok/ ── core/ ── ADB / sharp / tesseract / ONNX ── Android 模拟器

Electron 打包并承载 web + server；server-auth/ 是独立部署的云端服务。
```

- `core/`：与游戏无关的基础设施，包括 ADB 设备控制、模板匹配、YOLO、OCR、插件运行时、许可证客户端和远程控制客户端。不要在这里加入万国觉醒坐标或 UI 规则。
- `plugins/rok/`：万国觉醒专属配置、action、位置检测、模板与 ONNX 模型。游戏坐标按 1600×900 设计。
- `server/`：本地 Koa API。`PluginService` 注册插件，`TaskService` 创建/执行任务并按账号互斥，同时把 action 日志转为任务日志。
- `web/`：React 控制端。账号和许可证由 Context 管理；首页功能开关主要由 `Home.tsx` 调度，定义与默认值在 `plugins/rok/homeFeatures.ts`。
- `electron/`：桌面进程、托盘、窗口生命周期、自动更新及生产环境内嵌后端。
- `server-auth/`：独立 Koa + SQLite 服务，负责激活码、设备验证、远程控制 WebSocket、帮助页和更新文件，不属于本地 API 进程。

## 任务与插件执行链

前端通过 `POST /api/tasks` 创建任务，再调用运行接口：

```text
web → TaskService → PluginManager.runAction() → action.run(ctx, params)
```

Action 形态为 `{ id, name, description, run(ctx, params?) }`，统一在 `plugins/rok/index.ts` 暴露并由 `server/services/PluginService.ts` 注册。`PluginContext` 封装截图、点击、滑动、模板匹配、YOLO、OCR、配置读取和日志输出。

同一账号只能同时执行一个后端任务。取消通过 `stopRequested`/abort 实现，`PluginContext` 在阻塞操作前轮询停止状态；新增长循环时必须继续使用这些可取消封装。

## 图像识别与资源路径

- 模板匹配位于 `core/vision/Vision.ts`，基于 sharp；透明模板只比较 alpha ≥ 128 的像素。
- YOLO 封装位于 `core/vision/YoloDetector.ts`，模型存放在 `plugins/rok/models/`。
- OCR 单例位于 `core/ocr/OcrService.ts`，基于 tesseract.js；倒计时解析在 `core/ocr/parseCountdown.ts`。
- 模板、模型和 traineddata 必须通过 `core/resourcePath.ts` 的路径函数获取。不要在 action 中用 `__dirname` 直接拼生产资源路径；Electron 打包后资源位于 `process.resourcesPath`。
- ROK 模板存放于 `plugins/rok/templates/`。打包脚本会复制 templates、models、traineddata 和 ADB。

## 配置与前端状态

`server/services/ConfigService.ts` 按账号保存最多 5 个配置方案到 `~/.slg-automation/configs/{accountId}.json`。加载时配置会合并进 `DEFAULT_ROK_CONFIG`；`buildingPositions` 是整体替换而非递归合并。

首页功能字段的接口和默认值在 `plugins/rok/homeFeatures.ts`。新增首页设置时，通常需要同步检查：

1. `HomeFeatures` 与默认值；
2. `plugins/rok/index.ts` 中相关配置/action 参数；
3. `web/src/pages/Home.tsx` 的持久化、UI 和调度分支；
4. 老版本 localStorage/config 缺字段时的兼容行为。

## 远程控制

电脑端 `core/remote/RemoteClient.ts` 主动连接云端 `/ws/remote`；云端只负责路由和日志暂存，任务仍在本地执行。协议类型分别位于：

- `core/remote/messages.ts`
- `server-auth/ws/messages.ts`

协议变更需手动同步两边。开发模式下 Electron 与本地 Koa 是不同进程，Electron 通过 `/api/remote/start-client` 请求 Koa 进程启动 RemoteClient。

## 关键入口

- 本地服务：`server/index.ts`
- 任务执行：`server/services/TaskService.ts`
- 插件注册：`server/services/PluginService.ts`
- 插件上下文：`core/plugin/PluginContext.ts`
- ROK 插件与默认配置：`plugins/rok/index.ts`
- 首页调度：`web/src/pages/Home.tsx`
- 配置服务：`server/services/ConfigService.ts`
- Electron：`electron/main.ts`
- 云端服务：`server-auth/index.ts`
- 产品背景：`docs/SPEC.md`（部分路线图已过时，以当前代码为准）
