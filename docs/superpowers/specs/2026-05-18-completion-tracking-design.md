# 建筑/科技完成状态追踪 — 设计文档

日期: 2026-05-18

## 问题

建筑升级和科技研究成功后，对应 slot 被清空，用户无法知道哪些已完成。同时下拉框的互斥过滤阻止了同一建筑的重复选择。

## 设计

### 数据模型变更

**建筑：**
- `selectedBuildings: string[]` — 5 个槽位，保持不变。完成项不再清空
- 新增 `completedBuildings: boolean[]` — 与 `selectedBuildings` 一一对应，标记是否已完成

**科技：**
- `selectedTechs: string[]` — 同上
- 新增 `completedTechs: boolean[]`

**DEFAULT_FEATURES 初始值：**
```ts
selectedBuildings: ['', '', '', '', ''],
completedBuildings: [false, false, false, false, false],
selectedTechs: ['', '', '', '', ''],
completedTechs: [false, false, false, false, false],
```

### 互斥过滤取消

所有下拉框的选项列表不再做过滤，同一个建筑/科技可出现在任意多个 slot 中。

### 运行时行为

**启动时：**
- `completedBuildings` 和 `completedTechs` 全部重置为 `[false, false, false, false, false]`

**每轮执行：**
- 升级建筑：过滤 `selectedBuildings` 中 `completedBuildings[i] === true` 的项，传给后端的 `targetBuildings` 只包含未完成的
- 研究科技：同理过滤 `completedTechs`

**成功标记：**
- 升级成功 → 对应 slot 的 `completedBuildings[i] = true`
- 研究成功 → 对应 slot 的 `completedTechs[i] = true`

### UI 变更

**下拉框展示：**

已完成项 (completed = true)：
- 文字颜色变为绿色 (`text-green-400`)
- 边框变为绿色 (`border-green-500`)
- 前缀显示 ✅
- 不禁用，用户仍可改动；改动值时自动重置该 slot 的完成标记为 `false`

未完成项：保持现有灰色样式 (`text-white`, `border-gray-600`)

**清除已完成按钮：**

在下拉框行旁新增一个「清除已完成」按钮：
- 点击后将 `completedBuildings` 中所有已完成的 slot 对应 `selectedBuildings` 清空
- 重置 `completedBuildings` 为全 `false`
- 未完成的项自动向前补齐（compact），空槽排在末尾

补齐示例：
```
清除前: [✅学院, 伐木场, ✅兵营, 空, 空]
清除后: [伐木场,    空,    空,  空, 空]
```

### 涉及文件

| 文件 | 变更 |
|------|------|
| `web/src/pages/Home.tsx` | DEFAULT_FEATURES 新增 completed 字段；取消互斥过滤；建/科执行逻辑跳过已完成；清除按钮 + 补齐逻辑；下拉框绿色样式 |
