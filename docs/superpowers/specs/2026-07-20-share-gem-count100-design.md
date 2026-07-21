# 分享宝石矿新增“分享 100 个矿”停止条件

## 目标

在“分享宝石矿（小号用）”的搜索停止条件中增加“分享 100 个矿（测试）”。达到本次 `share-gem` action 新成功分享 100 个矿后停止。

## 计数语义

- 只统计本次 action 内成功分享的数量 `shared`。
- 不包含 `recordedCoords` 携带的历史已分享坐标。
- 分享失败不增加计数。
- 达到 100 后沿用现有 `targetCount` 早退逻辑返回成功。

## 改动范围

1. `plugins/rok/homeFeatures.ts`
   - `shareGemStopCondition` 联合类型增加 `count100`。
   - 默认值保持 `spiral`。
2. `web/src/pages/Home.tsx`
   - `count100` 映射为 `targetCount = 100`。
   - 下拉框增加“分享 100 个矿（测试）”。
   - `onChange` 类型同步增加 `count100`。
3. `plugins/rok/actions/shareGem.ts`
   - 不修改；复用已有 `shared >= targetCount` 判断。

## 兼容性

旧配置无需迁移。未设置或未知值仍通过现有回退使用 `spiral`，已有 5、10、15 和螺旋结束选项行为不变。

## 验证

- 回归测试验证 `count100` 类型、UI 选项及 `targetCount = 100` 映射。
- 运行 TypeScript 检查和前端生产构建。
