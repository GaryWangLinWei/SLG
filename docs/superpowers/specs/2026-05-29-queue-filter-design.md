# 队列速览 — 过滤干扰队列

> 版本：v1.0 | 日期：2026-05-29

## 目标

首次打开队列速览面板时，通过队列设置页面确保只勾选「部队训练」「建造队列」「科技研究」三项，过滤掉联盟帮助等其他干扰队列。

## 实现方案

### 流程

```
readQueueOverview 首次调用:
  1. module 级 flag 检查，已过滤则跳过
  2. tap(356, 157) → 打开队列设置面板
  3. 截取设置面板区域 (427,167)-(909,563)
  4. findAllImages('chooseState.png') → 找到所有已勾选的复选框
  5. 遍历找到的勾选:
       if 坐标不在三个目标位置的 15px 范围内 → tap 取消勾选
  6. 三个目标位置 [ 部队训练(465,212), 建造队列(465,366), 科技研究(465,443) ]:
       if 未找到该位置的勾选 → tap 勾选
  7. tap(356, 157) → 关闭设置面板
  8. 设置 flag = true
  9. 继续原有 OCR 速览流程
```

### 涉及文件

| 文件 | 改动 |
|------|------|
| `core/vision/Vision.ts` | 修复 `findAllImages`（完整的多匹配循环） |
| `core/plugin/PluginContext.ts` | 新增 `findAllImages` 方法 |
| `plugins/rok/index.ts` | 新增 settingsButton + queueCheckboxes 配置 |
| `plugins/rok/actions/readQueueOverview.ts` | 新增 `ensureQueueFilters`，首次调用时执行 |

### 坐标与容差

- 设置按钮：(356, 157)
- 搜索区域：(427, 167)-(909, 563) 即 482×396
- 目标复选框：部队训练(465,212)、建造队列(465,366)、科技研究(465,443)
- 位置匹配容差：15px
- 模板图：`plugins/rok/templates/chooseState.png`（已存在）
