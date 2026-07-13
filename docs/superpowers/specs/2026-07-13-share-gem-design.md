# 分享宝石矿 功能设计

**日期：** 2026-07-13
**状态：** Draft

## 背景

游戏内存在"分享宝石矿"玩法：找到宝石矿后可以把矿点分享给同盟主号，主号收到后可派队采集。当前只能手动一个个搜矿→点分享，效率低。需要一个自动化 action：从指定起点缩地螺旋搜宝石矿，每找到一个就自动分享给固定的主号，直到 81 步螺旋耗尽。

## 需求要点

- **入口：** Home 页新增独立卡片"分享宝石矿"，开关 + 起点坐标（X、Y）两个数字输入框
- **起点坐标 (0,0) = 未设置**，跳过坐标定位步骤，直接在当前视角原地螺旋搜
- **螺旋参数复用宝石采集配置**（`config.gemSearch`，81 步）
- **持久去重：** 同一次 action 生命周期内已分享的矿不再重复分享
- **早退保护：** 连续 3 次分享失败即退出本轮
- **调度：** 加入 Home 主 `Promise.all` 子循环，CD 1 分钟；与 `autoWorldChat` 互斥
- **前置：** 无需建筑标记

## 架构

### 文件结构

**新增：**
- `plugins/rok/actions/shareGem.ts` — 主 action（参考 `gatherGemFocus.ts` 结构）
- `plugins/rok/templates/share_gem/btn_share.png` — 分享按钮模板（用户已提供）
- `plugins/rok/templates/share_gem/mainrolehead.png` — 主号头像模板（用户已提供）

**修改：**
- `plugins/rok/homeFeatures.ts` — 新增 3 个字段
- `plugins/rok/index.ts` — 注册 `share-gem` action
- `core/plugin/PluginContext.ts` — 新增 `inputText(text: string)` 方法
- `web/src/pages/Home.tsx` — 新增 `shareGemLoop` + UI 卡片 + `computeExpectedActions`

## 数据结构

### HomeFeatures 新增字段

```typescript
shareGemEnabled: boolean;    // 默认 false
shareGemStartX: number;       // 默认 0（= 未设置）
shareGemStartY: number;       // 默认 0
```

### shareGem action 接口

```typescript
export interface ShareGemParams {
  startX: number;   // 0 表示跳过坐标定位
  startY: number;
  searchWeights?: GemSearchWeights;
  maxDistance?: number;
}

export interface ShareGemOutcome {
  result: 'success' | 'not_found' | 'aborted';
  shared: number;   // 成功分享数
}

export async function shareGem(
  ctx: PluginContext,
  config: RokConfig,
  params: ShareGemParams
): Promise<ShareGemOutcome>;
```

## 主流程

对应用户给出的 7 步：

```
1. zoomOutToWorld(ctx, worldBtn)                        // 重置城外视角

2. if (startX !== 0 || startY !== 0):
     await locateByCoord(ctx, startX, startY)           // 坐标定位子函数
   else:
     log '[step 2] 起点为 (0,0)，跳过定位'

3. await ctx.sleep(2)
   const spiralState = await createSpiralState(ctx, config, searchWeights)
   const sharedCoords: string[] = []                    // 持久去重
   let consecutiveFails = 0
   let shared = 0

4. while (true):
     const gem = await searchAndClickGem(
       ctx, config, spiralState, sharedCoords, maxDistance
     )
     if (!gem.found) break                              // 步数耗尽

     const outcome = await shareCurrentGem(ctx)
     
     if (outcome === 'ok'):
       shared++
       consecutiveFails = 0
       recordCurrentCoord(ctx, sharedCoords)            // OCR 当前坐标 → 持久去重
     else:
       consecutiveFails++
       if (consecutiveFails >= 3):
         return { result: 'aborted', shared }

5. return {
     result: shared > 0 ? 'success' : 'not_found',
     shared,
   }
```

### 关键点

- `searchAndClickGem` 已内置螺旋步数控制（81 步），走完自动返回 `not_found`，无需另加计数
- `sharedCoords` 与 `gatherGem` 的 `collectedCoords` 是同一套机制：分享成功后 OCR 当前坐标塞进数组，`searchAndClickGem` 自动跳过已在数组里的坐标
- `sharedCoords` 在函数内部创建，action 每轮启动都是空数组 —— 用户勾选期间每轮启动时刷新（跨轮不共享）

## 子函数

### `locateByCoord(ctx, x, y)` — 步骤 2

```typescript
async function locateByCoord(ctx: PluginContext, x: number, y: number) {
  await ctx.tap(552, 26);           // 打开坐标输入页
  await ctx.sleep(1);
  await ctx.tap(799, 176);           // 弹出 X 输入框
  await ctx.sleep(0.5);
  await ctx.inputText(String(x));    // 输入 X
  await ctx.sleep(0.3);
  await ctx.tap(987, 178);           // 弹出 Y 输入框
  await ctx.sleep(0.5);
  await ctx.inputText(String(y));    // 输入 Y
  await ctx.sleep(0.3);
  await ctx.tap(1108, 180);          // 搜索
  await ctx.sleep(1.5);              // 等镜头飞过去
}
```

### `shareCurrentGem(ctx)` — 步骤 4-6

```typescript
type ShareResult = 'ok' | 'no_share_btn' | 'no_mainrole' | 'confirm_failed';

async function shareCurrentGem(ctx: PluginContext): Promise<ShareResult> {
  // 步骤 4: 找分享按钮
  const shareBtn = await ctx.findImageWithLocation(BTN_SHARE, 0.7);
  if (!shareBtn.found) return 'no_share_btn';
  await ctx.tap(shareBtn.x, shareBtn.y);
  await ctx.sleep(1.2);

  // 步骤 5: 找主号头像（可能多个，取 y 最小 = 屏幕最上方）
  const heads = await ctx.findAllImages(MAINROLE_HEAD, 0.7);
  if (heads.length === 0) {
    await ctx.tap(1110, 102);        // 关闭分享列表
    return 'no_mainrole';
  }
  const target = heads.sort((a, b) => a.y - b.y)[0];
  await ctx.tap(target.x, target.y);
  await ctx.sleep(1);

  // 步骤 6: 确认 + 收回
  await ctx.tap(893, 551);           // 确认分享
  await ctx.sleep(1);
  await ctx.tap(782, 447);           // 收回分享框
  await ctx.sleep(0.8);

  return 'ok';
}
```

## PluginContext 扩展

`core/plugin/PluginContext.ts` 新增：

```typescript
inputText(text: string): Promise<void>;
```

实现：调用 `device.execShell('input text ' + escaped)`（字符串按 shell 转义）。

## Home.tsx 集成

### 新增 `shareGemLoop` 子循环

放在 `caveLoop` 附近，加入 `Promise.all`：

```tsx
const shareGemLoop = (async () => {
  let first = true;
  while (!isStopped()) {
    if (first) { first = false; await sleep(10); continue; }
    if (offlineActive) { await sleep(30); continue; }

    if (featuresRef.current.shareGemEnabled && !featuresRef.current.autoWorldChat) {
      if (!await acquireLock()) break;
      if (offlineActive) { releaseLock(); await sleep(30); continue; }
      await ensureGameRunning();
      try {
        const createResult = await api.tasks.create(
          currentAccountId, 'com.rok.automation', 'share-gem',
          {
            startX: featuresRef.current.shareGemStartX,
            startY: featuresRef.current.shareGemStartY,
          }
        );
        if (createResult.success) {
          runningTaskIdsRef.current = [...runningTaskIdsRef.current, createResult.task.id];
          setRunningTaskIds([...runningTaskIdsRef.current]);
          const runResult = await api.tasks.run(createResult.task.id);
          runningTaskIdsRef.current = runningTaskIdsRef.current.filter(id => id !== createResult.task.id);
          setRunningTaskIds([...runningTaskIdsRef.current]);
          const logs = runResult.task?.logs ?? [];
          if (logs.some((l: string) => l.includes('许可证已过期'))) {
            pushLog('⛔ 许可证已到期，停止运行');
            loopStopped = true;
            setExpiredMessage('激活码已到期，请重新激活');
            refreshStatus();
          } else {
            pushLog('💎 分享宝石矿 完成');
            markRoundDone('share-gem');
          }
        }
      } catch {} finally { releaseLock(); }
    }

    // CD 1 分钟，可被 cooldownResetSeq 打断
    const startWait = monotonicNow();
    const waitSeq = cooldownResetSeq;
    while (!isStopped() && cooldownResetSeq === waitSeq && (monotonicNow() - startWait) < 60_000) {
      await sleep(1);
    }
  }
})();
```

`Promise.all([...其他子循环, shareGemLoop])`

### UI 卡片

放在宝石采集卡片下方，emerald 绿色开关配色：

```tsx
<div className="feature-card ...">
  <div className="flex items-center justify-between">
    <span>💎 分享宝石矿</span>
    <input type="checkbox" checked={features.shareGemEnabled}
      disabled={features.autoWorldChat}
      onChange={e => setFeatures({ ...features, shareGemEnabled: e.target.checked })}
      className="sr-only" />
    {/* switch UI */}
  </div>
  <div className="mt-2 flex gap-2">
    <label>起点 X
      <input type="number" value={features.shareGemStartX}
        onChange={e => setFeatures({ ...features, shareGemStartX: Number(e.target.value) })} />
    </label>
    <label>起点 Y
      <input type="number" value={features.shareGemStartY}
        onChange={e => setFeatures({ ...features, shareGemStartY: Number(e.target.value) })} />
    </label>
  </div>
</div>
```

### computeExpectedActions

```tsx
if (f.shareGemEnabled) exp.add('share-gem');
```

## 错误处理

- `locateByCoord` 内每次 tap 前 `checkStop`（PluginContext 自动做）
- `shareCurrentGem` 三种失败返回值都算 `consecutiveFails++`
- 整个 `shareGem` 用 try/catch 包住主循环，未预期异常也算失败
- `consecutiveFails >= 3` 主动早退，返回 `'aborted'`
- 步数耗尽（`searchAndClickGem` 返回 `!found`）返回 `'success'`（如果分享过至少一次）或 `'not_found'`

## 日志输出

对齐现有 action 风格：

- `=== 分享宝石矿 起点(x,y) ===`
- `[step 1] 重置城外视角`
- `[step 2] 定位坐标 (x,y)` 或 `[step 2] 起点为 (0,0)，跳过定位`
- `[step 3] 开始螺旋搜索`
- `[分享] 成功: (x,y)` / `⚠️ 找不到分享按钮` / `⚠️ 找不到主号头像`
- `[早退] 连续 3 次失败，退出`
- `=== 分享结束: 分享 N 个 ===`

## 验证方案

- **编译检查：** `npx tsc` 通过
- **手动验证：**
  1. 勾选卡片，起点填 (0,0)，跑一轮看日志（应跳过定位直接螺旋搜）
  2. 起点填非 (0,0)，看是否成功定位
  3. 在没有宝石的空区域跑，观察是否连续 3 次失败后早退
  4. 勾选 `autoWorldChat`，观察分享卡片是否 disabled
- **不写单测：** action 依赖 UI 坐标和图像识别，端到端手动跑更可靠

## 关键坐标参考

| 用途 | 坐标 |
|------|------|
| 打开坐标输入页 | (552, 26) |
| X 输入框 | (799, 176) |
| Y 输入框 | (987, 178) |
| 坐标搜索按钮 | (1108, 180) |
| 确认分享按钮 | (893, 551) |
| 收回分享框 | (782, 447) |
| 关闭分享列表（无主号兜底） | (1110, 102) |
