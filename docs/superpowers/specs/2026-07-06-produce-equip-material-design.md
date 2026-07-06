# 生产装备材料 Action

## Context

城内铁匠铺可定期生产装备材料（皮革 / 铁矿石 / 乌木 / 兽骨）。目前需手动操作，希望挂入首页"社交与辅助"卡片，作为循环子任务每 2~4 小时随机跑一次。

## 需求

- 前端：社交与辅助卡片内加"生产装备材料"开关 + 材料单选下拉
- 后端 action：铁匠铺 → 生产材料界面 → 点击对应材料 2 或 3 次（每次 action 随机一次）→ 关闭
- 循环调度：每次执行完，下一次间隔在 [2h, 4h] 内随机
- 找不到"生产材料"入口按钮时正常结束（视为该建筑等级不足或未解锁），不报错

## Action：`produce-equip-material`

**文件**：`plugins/rok/actions/produceEquipMaterial.ts`

**参数**：`{ material: 'leather' | 'iron' | 'ebony' | 'bone' }`

**流程**：
1. `ensureInCity()` — 重置到城内视角
2. 将铁匠铺拖到屏幕中心（读 `config.buildingPositions.blacksmith`，复用现有 `dragBuildingToCenter` 公共方法）
3. `tap()` 铁匠铺 → 弹出操作菜单
4. `findImageWithLocation('btn_produce_material.png', 0.7)`
   - 未命中 → `log('未找到生产材料按钮，跳过')` → return
   - 命中 → `tap()` 进入材料界面
5. 从 `MATERIAL_REGIONS[material]` 取区域中心点，`randInt(2, 3)` 次点击，每次间隔 `random(0.4, 0.8)` 秒
6. `tap(1363, 103)` 关闭材料界面
7. 结束

**材料坐标表**：
```ts
const MATERIAL_REGIONS: Record<string, { x1: number; y1: number; x2: number; y2: number }> = {
  leather: { x1: 918,  y1: 256, x2: 989,  y2: 323 },
  iron:    { x1: 1035, y1: 257, x2: 1103, y2: 326 },
  ebony:   { x1: 1152, y1: 260, x2: 1222, y2: 325 },
  bone:    { x1: 1269, y1: 260, x2: 1336, y2: 325 },
};
```

点击坐标取区域中心；`AdbDevice.tapOffset` 已提供 ±7px 随机偏移，无需额外抖动。

## HomeFeatures 变更

`plugins/rok/homeFeatures.ts`：

```ts
produceMaterialEnabled: boolean;      // 默认 false
produceMaterialType: 'leather' | 'iron' | 'ebony' | 'bone';  // 默认 'leather'
```

## 前端 UI

`web/src/pages/Home.tsx` — "社交与辅助"卡片内新增：
- 开关：`produceMaterialEnabled`
- 材料下拉：皮革 / 铁矿石 / 乌木 / 兽骨（对应 `produceMaterialType`）

**不显示间隔设置**（内部固定 2~4 小时随机）。

## 循环调度

参考现有城寨/宝石循环模式，在 home loop 中：
- `produceMaterialEnabled === true` 时挂载
- 每次执行完，下次触发延时 `randRange(2*3600, 4*3600)` 秒
- 遵循已有的 `checkStop` / 双重守卫模式

## 模板资源

新增 `plugins/rok/templates/btn_produce_material.png`（用户提供）。

## 注册

`plugins/rok/index.ts` 的 actions 列表新增：
```ts
{ id: 'produce-equip-material', name: '生产装备材料', description: '在铁匠铺生产指定装备材料', run: produceEquipMaterial }
```

## 验证

1. 关闭开关：循环不触发该 action
2. 开关打开、选择皮革：手动跑一次 → 视角回城内 → 铁匠铺居中 → 进入材料界面 → 点击皮革 2~3 次 → 关闭
3. 铁匠铺等级不够（识别不到"生产材料"按钮）：log 提示后正常结束
4. 循环模式下：两次执行间隔落在 [2h, 4h] 之间

## 关键文件

- `plugins/rok/actions/produceEquipMaterial.ts` — 新增
- `plugins/rok/homeFeatures.ts` — 加两字段
- `plugins/rok/index.ts` — 注册 action
- `plugins/rok/templates/btn_produce_material.png` — 用户提供
- `web/src/pages/Home.tsx` — 社交与辅助卡片加 UI + 循环挂载
