# 组合采集有效条件设计

**日期：** 2026-07-25

## 目标

只有在账号调度已开启、下拉选择“组合采集”且账号调度功能未被锁定时，组合采集行为才实际生效。否则整体按普通模式运行。

## 有效条件

在 `web/src/pages/Home.tsx` 的任务参数组装处使用统一语义：

```ts
const comboGemActive =
  features.autoSwitchAccount &&
  features.switchMode === 'combo-gem' &&
  !isFeatureLocked('autoSwitchAccount');
```

异步循环中使用对应时点的最新配置对象（如 `featuresRef.current` 或 `fNow`），避免读取旧状态。

## 行为

当 `comboGemActive=true`：

- `poolAccountId` 使用 `COMBO_GEM_POOL_ACCOUNT_ID`；
- 分享宝石矿设置 `skipShareClick=true`；
- 采集分享矿设置 `skipChatCollect=true`。

当 `comboGemActive=false`：

- `poolAccountId` 使用当前账号 ID；
- `skipShareClick=false`，执行游戏内分享；
- `skipChatCollect=false`，池不足时从聊天收集。

账号调度关闭时不重置“组合采集”下拉值；再次开启账号调度后，组合模式自动恢复生效。

## 范围

仅修改 `web/src/pages/Home.tsx` 中分享宝石任务和采集分享矿任务的参数组装。不修改后端 action、共享池实现、账号切换流程或 UI 控件。

## 测试与验证

- 检查分享任务和采集任务使用同一有效条件语义；
- 覆盖账号调度开启/关闭、组合/非组合及功能锁定状态；
- 运行前端构建 `cd web && npm run build`；
- 检查差异不包含无关改动。
