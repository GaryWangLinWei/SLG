# 基于 OCR 的智能调度 — 设计文档

日期: 2026-05-20

## 目标

用 OCR 读取队列倒计时替代固定间隔轮询，精准调度 action 执行，降低交互频率，增强防脚本检测。

## 核心变化

```
现在：轮询间隔到了 → 不管有没有东西都去点一遍 → 等下一个间隔

改后：队列速览面板 OCR 倒计时 → 到时间精准执行 → 长间隔等待
```

## 设计

### 1. OCR 模块 `core/ocr/OcrService.ts`

- 封装 Tesseract.js，纯 JS，无系统依赖
- `readRegion(imagePath, x, y, w, h): Promise<string>` — 截取区域并识别文本
- 单例，首次加载 eng 语言包后缓存

### 2. 倒计时解析 `core/ocr/parseCountdown.ts`

支持格式（含 OCR 容错）：

| 原始文本 | 解析结果 |
|----------|----------|
| `1天10:09:20` | 122960 秒 |
| `2:30:00` | 9000 秒 |
| `45:30` | 2730 秒 |

容错：`1夭` → `1天`，冒号丢失补全，非数字字符过滤。

### 3. 队列速览集成

**配置项新增（RokConfig）：**

```ts
queueOverview: {
  openButton: { x, y };           // 速览面板按钮
  closeButton?: { x, y };         // 关闭按钮
  rows: {
    build: { x, y, w, h };        // 建造队列倒计时区域
    train: { x, y, w, h };        // 训练队列
    research: { x, y, w, h };     // 研究队列
  };
};
```

**OCR 流程：**

```
点击速览按钮 → 截取面板 → 逐个裁剪 3 个区域 → OCR 各区域 → 关闭面板 → 返回倒计时
```

### 4. 调度逻辑（Home.tsx）

```
while (循环运行) {
  打开队列速览 → OCR 全部倒计时 → 关闭面板

  for 每个队列 (建造/训练/研究):
    if 倒计时 == 0 且有待处理项:
      → 执行对应 action
      → 成功后从队列移除

  if 距上次收集 >= 4h:
    → 执行收集

  // 计算下次唤醒：取最近到期倒计时 × 0.6，上限 30 分钟
  nextWake = min(最近到期倒计时 × 0.6, 30分钟)
  nextWake += 随机抖动 (-30s ~ +120s)
  sleep(nextWake)
}
```

- 系数 0.6：留余地，盟友帮助会缩短倒计时
- 上限 30 分钟：防止几天后的大倒计时导致过长不检查
- 抖动 -30s~+120s：模拟人类不精确的时间感知

### 5. 涉及文件

| 文件 | 改动 |
|------|------|
| `core/ocr/OcrService.ts` | 新建，OCR 封装 |
| `core/ocr/parseCountdown.ts` | 新建，时间解析 |
| `plugins/rok/index.ts` | 新增 queueOverview 配置 |
| `plugins/rok/actions/upgradeBuildings.ts` | 无重大改动（action 本身不变） |
| `plugins/rok/actions/researchTech.ts` | 无重大改动 |
| `plugins/rok/actions/trainTroops.ts` | 无重大改动 |
| `web/src/pages/Home.tsx` | 主循环改造为调度模式 |
| `package.json` | 新增 `tesseract.js` |

### 6. 依赖

```bash
npm install tesseract.js
```
