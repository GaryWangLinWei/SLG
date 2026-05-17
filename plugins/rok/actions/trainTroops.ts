import { PluginContext } from '../../../core/plugin';
import { RokConfig } from '../index';
import { resetCityView } from '../utils/location';
import * as path from 'path';
import sharp from 'sharp';

const TEMPLATE_DIR = path.join(__dirname, '../templates');

// 训练按钮模板映射（建筑名 → 模板文件名）
const TRAIN_TEMPLATES: Record<string, string> = {
  '兵营': 'train_bubing.png',
  '马厩': 'train_qibing.png',
  '靶场': 'train_gongbing.png',
  '攻城武器厂': 'train_che.png',
};

// T1-T5 固定坐标
const TIER_BUTTONS: Record<number, { x: number; y: number }> = {
  1: { x: 787, y: 218 },
  2: { x: 915, y: 218 },
  3: { x: 1040, y: 218 },
  4: { x: 1172, y: 218 },
  5: { x: 1294, y: 218 },
};

const TRAIN_BUTTON = { x: 1213, y: 730 };

export type TrainResult = 'success' | 'busy' | 'not_found' | 'no_train_button';

export async function trainTroopsSingle(
  ctx: PluginContext,
  config: RokConfig,
  targetBuilding: string,
  targetTier: number
): Promise<TrainResult> {
  const trainTemplateFile = TRAIN_TEMPLATES[targetBuilding];
  if (!trainTemplateFile) {
    ctx.log(`❌ 不支持的训练建筑: ${targetBuilding}`);
    return 'not_found';
  }

  ctx.log(`=== 开始训练兵种: ${targetBuilding} T${targetTier} ===`);

  const trainTemplatePath = path.join(TEMPLATE_DIR, trainTemplateFile);

  // ============================================
  // 第 0 步: 重置城内视野
  // ============================================
  await resetCityView(ctx, config);

  // ============================================
  // 第 1 步: 点击兵营建筑
  // ============================================
  const buildPos = config.buildingPositions[targetBuilding];
  if (!buildPos) {
    ctx.log(`❌ 未找到建筑坐标: ${targetBuilding}`);
    return 'not_found';
  }
  ctx.log(`--- 第 1 步: 点击 ${targetBuilding} (${buildPos.x}, ${buildPos.y}) ---`);
  await ctx.tap(buildPos.x, buildPos.y);
  await ctx.tap(buildPos.x, buildPos.y);
  await ctx.sleep(2);

  // ============================================
  // 第 2 步: 图像识别训练按钮，首次缩放识别后缓存坐标
  // ============================================
  ctx.log('--- 第 2 步: 识别弹出训练按钮 ---');
  const CACHE_KEY = `train_${targetBuilding}_btn`;
  let trainX: number;
  let trainY: number;

  const cached = ctx.getCachedLocation(CACHE_KEY);
  if (cached) {
    trainX = cached.x;
    trainY = cached.y;
    ctx.log(`使用缓存的训练按钮坐标 (${trainX}, ${trainY})`);
  } else {
    const popup = await ctx.findImageWithLocation(trainTemplatePath, 0.7, [0.7, 0.8, 0.9, 1.0, 1.1]);
    if (!popup.found) {
      ctx.log(`❌ 未找到弹出训练按钮 (confidence: ${popup.confidence.toFixed(3)})`);
      return 'no_train_button';
    }
    trainX = popup.x;
    trainY = popup.y;
    ctx.setCachedLocation(CACHE_KEY, trainX, trainY);
    ctx.log(`识别并缓存训练按钮 (${trainX}, ${trainY})`);
  }
  await ctx.tap(trainX, trainY);
  await ctx.sleep(2);

  // ============================================
  // 第 3 步: 检测是否已在训练中
  // ============================================
  ctx.log('--- 第 3 步: 检测是否已在训练中 ---');
  const cancelTemplate = path.join(TEMPLATE_DIR, 'cancelTrainBtn.png');
  const { width: cancelW = 120, height: cancelH = 50 } = await sharp(cancelTemplate).metadata();
  const cancelRegion = await ctx.captureRegion(
    808 - Math.floor(cancelW! / 2),
    526 - Math.floor(cancelH! / 2),
    cancelW!, cancelH!
  );

  const cancelDiff = await ctx.compareImages(cancelRegion, cancelTemplate);
  ctx.log(`  取消训练按钮匹对差异: ${(cancelDiff * 100).toFixed(1)}%`);

  if (cancelDiff < 0.3) {
    ctx.log('  ⏳ 已有兵种正在训练中，返回');
    await ctx.tap(config.backButton.x, config.backButton.y);
    await ctx.sleep(1);
    return 'busy';
  }
  ctx.log('  训练队列空闲，继续');

  // ============================================
  // 第 4 步: 选择兵种等级 T1-T5
  // ============================================
  const tierBtn = TIER_BUTTONS[targetTier];
  if (!tierBtn) {
    ctx.log(`❌ 无效的兵种等级: T${targetTier}`);
    return 'not_found';
  }
  ctx.log(`--- 第 4 步: 选择 T${targetTier} (${tierBtn.x}, ${tierBtn.y}) ---`);
  await ctx.tap(tierBtn.x, tierBtn.y);
  await ctx.sleep(1);

  // ============================================
  // 第 5 步: 点击训练按钮
  // ============================================
  ctx.log(`--- 第 5 步: 点击训练按钮 (${TRAIN_BUTTON.x}, ${TRAIN_BUTTON.y}) ---`);
  await ctx.tap(TRAIN_BUTTON.x, TRAIN_BUTTON.y);
  await ctx.sleep(1);

  ctx.log(`=== ${targetBuilding} T${targetTier} 训练完成 ===`);
  return 'success';
}
