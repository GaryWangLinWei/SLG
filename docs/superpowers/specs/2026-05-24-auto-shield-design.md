# 受到攻击自动开盾

## 目标

当主城被攻击时，自动检测并激活和平护盾，避免被掠夺。攻击资源点时不触发开盾。

## 检测机制

### 两种攻击类型

右下角出现相同攻击图标，但被攻击地点不同：

| 攻击类型 | 面板中文字 | 处理 |
|---------|-----------|------|
| 攻击主城 | "您的城市" | **开盾** |
| 攻击资源点 | 其他文字 | 忽略 |

### 检测流程

```
shieldLoop (独立 async IIFE, 每 2-3s):
  1. 直接调用 API: 截取右下角区域 → 像素对比 Icon_Attack.png
     - 不走任务系统，不走前后端锁
     - ADB 层面串行排队，单次延迟 ~200ms
  2. if 图标不匹配 → 继续循环
  3. if 图标匹配 → 点击图标打开面板
  4. OCR 读取面板区域 (1103,239)-(1201,266)
  5. if 不是"您的城市" → 关闭面板，继续循环
  6. if 是"您的城市":
     a. api.tasks.stop(runningTaskId)   // 打断当前 action
     b. await acquireLock()             // 等锁释放后获取
     c. 执行开盾 action
     d. releaseLock()
```

### 关键设计决策

- **检测不走锁** — 只读截屏不影响设备操作，避免主循环持锁 10-15s 内无法检测
- **检测不经任务系统** — 不创建 task，不排队等待，减少延迟到 200ms 级别
- **stopTask 打断** — 调用 `api.tasks.stop()` 触发后端 `checkStop`，当前 action 在下次 `tap()`/`sleep()` 处中断（通常 < 1s）
- **前端 acquireLock 排队** — 确保开盾完成后主循环才继续

## 开盾操作流程 (action: `activate-peace-shield`)

```
1. 展开底部栏
2. 点击道具按钮 (1033, 838)
3. 点击增益分类标签 (784, 105)
4. 图像识别 tool_huzhao.png
   - 未找到 → 点击返回按钮 (1392, 107) → 到步骤6
   - 找到 → 点击护盾道具 → 点击使用按钮 (1222, 775) → 到步骤5
5. 等待 1s，点击返回关闭道具面板
6. 收起底部栏
```

## 涉及文件

| 文件 | 改动 |
|------|------|
| `plugins/rok/actions/activatePeaceShield.ts` | **新建** — 开盾 action |
| `plugins/rok/index.ts` | 注册 `activate-peace-shield` action + 新增 attack 检测配置项 |
| `web/src/pages/Home.tsx` | 新增 `shieldLoop` 独立循环 + `autoShield` feature + 检测 API 调用 |
| `web/src/api/client.ts` | 可能需要新增轻量检测 API（或复用现有接口） |

## 配置项

新增到 `RokConfig`：

```ts
attackDetection?: {
  iconRegion: { x: number; y: number; w: number; h: number };  // 右下角攻击图标区域
  iconTemplate: string;       // "Icon_Attack.png"
  panelTextRegion: { x1: number; y1: number; x2: number; y2: number };  // OCR 区域
  shieldTemplate: string;     // "tool_huzhao.png"
  itemsButton: { x: number; y: number };    // 道具按钮 1033,838
  buffTab: { x: number; y: number };        // 增益标签 784,105
  useButton: { x: number; y: number };      // 使用按钮 1222,775
  returnButton: { x: number; y: number };   // 返回按钮 1392,107
  checkInterval: number;      // 检测间隔秒数，默认 3
};
```

## Feature 开关

在 `HomeFeatures` 中新增 `autoShield: boolean`，前端 UI 添加勾选框。

## 与其他循环的关系

- `shieldLoop` 和 `helpLoop`/`collectLoop`/`gatherLoop` 同为独立循环
- 检测阶段无锁并行
- 开盾时通过 `acquireLock` 排队，与主循环、其他独立循环互斥
- 开盾通过 `api.tasks.stop()` 主动打断正在执行的 task

## 异常处理

- 护盾道具不存在（用完了）→ 记录告警日志，跳过
- OCR 识别面板文字失败 → 保守处理，不开盾（防止误操作）
- 开盾过程中 loopStopped → 中断退出
- 许可证过期 → 和现有循环一致的处理
