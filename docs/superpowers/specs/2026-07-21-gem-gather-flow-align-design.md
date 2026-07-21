# 宝石采集流程对齐设计

## 目标

将普通/专注宝石采集流程从「先点击固定矩形区域，再二次确认」改为「先 bigGem 二次确认获取精确坐标，再点击该坐标」，与分享矿采集 (`gatherSharedGem`) 的行为和数据依赖保持一致。

## 当前状态

### 普通/专注采集（修改前）

```
1. 点击 gemX, gemY（螺旋搜索坐标）→ sleep 1.5s
2. caiji 状态检测（模板匹配 CAIJI_STATE_TEMPLATE，固定区域 745, 360, 157, 142）
   - 命中 → zoomOut → continue
3. 点击固定矩形 PINCHED_GEM_TARGET_RECT → sleep 1s
4. verifyGemAtCenter() → 只检查 found，不使用返回的精确坐标
   - 失败 → zoomOut → continue
5. 坐标去重（OCR 顶部 400, 11, 137, 32）
   - 重复 → zoomOut → continue
6. 找采集按钮并点击
```

### 分享矿采集（现有，保持不变）

```
1. locateByCoord() 定位到分享坐标
2. verifyGemAtCenter() → verified.x/y
   - 失败 → 截图 debug，取下一个矿
3. caiji 状态检测（YOLO，以 verified.x/y 为中心，120×120）
   - 命中 → 取下一个矿
4. 点击 verified.x, verified.y → sleep 1s
5. 找采集按钮并点击
```

## 新设计（普通/专注采集）

```
1. 点击 gemX, gemY（螺旋搜索坐标）→ sleep 1.5s
2. verifyGemAtCenter() → verified.x/y
   - 失败 → zoomOut → continue
3. caiji 状态检测（YOLO，以 verified.x/y 为中心，120×120）
   - 命中 → zoomOut → continue
4. 坐标去重（OCR 顶部 400, 11, 137, 32）
   - 重复 → zoomOut → continue
5. 点击 verified.x, verified.y → sleep 1s
6. 找采集按钮并点击
```

## 改动点

### 新增依赖

- `verifyGemAtCenter()` 不仅用于「存在性确认」，还需要 `verified.x/y` 作为：
  - caiji 状态检测的区域中心
  - 最终宝石点击的精确坐标

### 移除

- 固定矩形点击：`PINCHED_GEM_TARGET_RECT` 相关代码和常量可移除
- caiji 模板匹配：`CAIJI_STATE_TEMPLATE` 检测固定区域的逻辑可移除
- 可同步清理配置中不再使用的 `pinchedGemTapPoint` 字段

### 对齐的行为

- 与 `gatherSharedGem` 一致：先二次确认 → caiji 检测 → 去重 → 点击确认坐标
- 只在确认「未被采集、坐标未重复、宝石存在」后才点击，避免无效点击
- 后续采集按钮检测保持不变

## 验证策略

### 单元测试

- 更新 `searchAndClickGem` 相关测试
- 验证 flow 顺序：verify → caiji detection → dedupe → tap verified coords
- 失败路径验证：verify 失败、caiji 命中、坐标重复均正确走 zoomOut
- 确保不再调用 `tapRect(PINCHED_GEM_TARGET_RECT.*)`

### 集成验证

- 运行相关 Jest：`gatherGem.test.ts`
- `tsc --noEmit` 无错误
- 确认常量 `PINCHED_GEM_TARGET_RECT` 已无引用（除非配置保留但代码不使用）

## 非目标

- 不改变 `gatherSharedGem` 的现有流程
- 不改变 `gatherGemFocus` 专注模式的外层循环逻辑
- 不改变螺旋搜索、采集按钮查找和派兵逻辑
