import { PluginContext } from '../../../core/plugin';
import { RokConfig } from '../index';
import { resetCityView, swipeBuildingToCenter } from '../utils/location';
import { getTemplatesDir } from '../../../core/resourcePath';
import * as path from 'path';

const TEMPLATE_DIR = getTemplatesDir();
const PRODUCE_BTN_TEMPLATE = path.join(TEMPLATE_DIR, 'btn_produce_material.png');

export type MaterialType = 'leather' | 'iron' | 'ebony' | 'bone';

const MATERIAL_REGIONS: Record<MaterialType, { x1: number; y1: number; x2: number; y2: number; label: string }> = {
  leather: { x1: 918,  y1: 256, x2: 989,  y2: 323, label: '皮革' },
  iron:    { x1: 1035, y1: 257, x2: 1103, y2: 326, label: '铁矿石' },
  ebony:   { x1: 1152, y1: 260, x2: 1222, y2: 325, label: '乌木' },
  bone:    { x1: 1269, y1: 260, x2: 1336, y2: 325, label: '兽骨' },
};

const CLOSE_BUTTON = { x: 1363, y: 103 };
const BUILDING_KEY = '铁匠铺';

export type ProduceMaterialResult = 'success' | 'no_produce_button' | 'no_building';

/**
 * 铁匠铺生产装备材料：
 * 1. 重置城内视角
 * 2. 拖动铁匠铺到中心并点击
 * 3. 识别"生产材料"入口按钮，未识别到 → 返回 no_produce_button
 * 4. 点击进入材料界面
 * 5. 点击对应材料区域中心 2 或 3 次（本次 action 随机决定）
 * 6. 点击关闭按钮
 */
export async function produceEquipMaterial(
  ctx: PluginContext,
  config: RokConfig,
  material: MaterialType,
): Promise<ProduceMaterialResult> {
  const buildPos = config.buildingPositions[BUILDING_KEY];
  if (!buildPos) {
    ctx.log(`❌ 未找到建筑坐标: ${BUILDING_KEY}`);
    return 'no_building';
  }

  const region = MATERIAL_REGIONS[material];
  ctx.log(`=== 开始生产装备材料 (${region.label}) ===`);

  // 1. 重置城内视角
  await resetCityView(ctx, config);

  // 2. 拖动铁匠铺到中心并点击
  await swipeBuildingToCenter(ctx, buildPos, BUILDING_KEY);
  await ctx.sleep(1);

  // 3. 识别"生产材料"入口按钮
  ctx.log('[3/6] 识别生产材料按钮');
  const btn = await ctx.findImageWithLocation(PRODUCE_BTN_TEMPLATE, 0.7, [0.7, 0.8, 0.9, 1.0, 1.1]);
  if (!btn.found) {
    ctx.log(`  ❌ 未找到生产材料按钮（可能铁匠铺等级不足或未解锁），结束 (confidence: ${btn.confidence.toFixed(3)})`);
    return 'no_produce_button';
  }
  ctx.log(`  ✅ 找到生产材料按钮 (${btn.x}, ${btn.y})，置信度: ${btn.confidence.toFixed(3)}`);

  // 4. 点击进入材料界面
  ctx.log(`[4/6] 点击生产材料按钮`);
  await ctx.tap(btn.x, btn.y);
  await ctx.sleep(1.5);

  // 5. 点击材料 2 或 3 次
  const times = 2 + Math.floor(Math.random() * 2); // 2 or 3
  const cx = Math.round((region.x1 + region.x2) / 2);
  const cy = Math.round((region.y1 + region.y2) / 2);
  ctx.log(`[5/6] 点击 ${region.label} (${cx}, ${cy}) ${times} 次`);
  for (let i = 0; i < times; i++) {
    await ctx.tap(cx, cy);
    // 每次间隔 0.4~0.8 秒
    await ctx.sleep(0.4 + Math.random() * 0.4);
  }

  // 6. 关闭
  ctx.log(`[6/6] 关闭材料界面 (${CLOSE_BUTTON.x}, ${CLOSE_BUTTON.y})`);
  await ctx.tap(CLOSE_BUTTON.x, CLOSE_BUTTON.y);
  await ctx.sleep(1);

  ctx.log(`=== 生产装备材料完成 (${region.label} × ${times}) ===`);
  return 'success';
}
