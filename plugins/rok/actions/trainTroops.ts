import { PluginContext } from '../../../core/plugin';
import { RokConfig } from '../index';
import { resetCityView } from '../utils/location';
import { getTemplatesDir } from '../../../core/resourcePath';
import * as path from 'path';
import * as fs from 'fs/promises';
import sharp from 'sharp';

const TEMPLATE_DIR = getTemplatesDir();

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
  // 第 1 步: 拖动建筑到中心，再点击
  // ============================================
  const buildPos = config.buildingPositions[targetBuilding];
  if (!buildPos) {
    ctx.log(`❌ 未找到建筑坐标: ${targetBuilding}`);
    return 'not_found';
  }
  ctx.log(`--- 第 1 步: 拖动 ${targetBuilding} 到屏幕中心 (${buildPos.x}, ${buildPos.y} → 800, 450) ---`);
  await ctx.swipe(buildPos.x, buildPos.y, 800, 450, 1000);
  await ctx.tap(800, 450);  // 打断惯性
  await ctx.sleep(0.3);
  await ctx.tap(800, 450);
  await ctx.sleep(0.5);
  await ctx.tap(800, 450);
  await ctx.sleep(1);

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
    const TRAIN_SEARCH_REGION = { x: 776, y: 461, width: 378, height: 300 };
    const popup = await ctx.findImageWithLocation(trainTemplatePath, 0.6, [0.7, 0.8, 0.9, 1.0, 1.1], false, undefined, TRAIN_SEARCH_REGION);
    ctx.log(`  训练按钮最高置信度: ${popup.confidence.toFixed(3)}`);
    if (!popup.found) {
      ctx.log(`❌ 未找到弹出训练按钮`);
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
  // 第 3 步: 检测是否已在训练中 (detailUpgradeButton)
  // ============================================
  ctx.log('--- 第 3 步: 检测是否已在训练中 ---');
  const detailUpgradeTemplate = path.join(TEMPLATE_DIR, 'detailUpgradeButton.png');
  const { width: detailW = 200, height: detailH = 60 } = await sharp(detailUpgradeTemplate).metadata();

  const detail = await ctx.findImageWithLocation(detailUpgradeTemplate, 0.7);
  if (!detail.found) {
    ctx.log(`  ❌ 未识别到可训练状态 (${detail.confidence.toFixed(3)})，返回`);
    await ctx.tap(config.backButton.x, config.backButton.y);
    await ctx.sleep(1);
    return 'no_train_button';
  }
  ctx.log(`  训练队列空闲 (confidence: ${detail.confidence.toFixed(3)})，继续`);

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

  // ============================================
  // 第 6 步: 检测资源不足弹窗
  // ============================================
  ctx.log('--- 第 6 步: 检测资源不足弹窗 ---');
  const closeBtnTemplate = path.join(TEMPLATE_DIR, config.closeBtnTemplate);
  const { width: closeW = 40, height: closeH = 40 } = await sharp(closeBtnTemplate).metadata();
  const closeRegion = await ctx.captureRegion(1243, 158, closeW!, closeH!);

  const closeDiff = await ctx.compareImages(closeRegion, closeBtnTemplate);
  ctx.log(`  closeBtn 匹对差异: ${(closeDiff * 100).toFixed(1)}%`);
  await fs.unlink(closeRegion).catch(() => {});

  if (closeDiff >= 0.3) {
    ctx.log(`=== ${targetBuilding} T${targetTier} 训练完成 ===`);
    return 'success';
  }

  ctx.log('  💰 资源不足，点击一键补充');

  // ============================================
  // 第 6.1 步: 点击一键补充按钮
  // ============================================
  ctx.log('--- 第 6.1 步: 点击一键补充 ---');
  const REPLENISH_BTN = { x: 1004, y: 624 };
  await ctx.tap(REPLENISH_BTN.x, REPLENISH_BTN.y);
  await ctx.sleep(1);

  // ============================================
  // 第 6.2 步: 判断弹窗类型并处理
  // ============================================
  ctx.log('--- 第 6.2 步: 判断弹窗类型 ---');
  const yesBtnTemplate = path.join(TEMPLATE_DIR, 'yesBtn.png');
  const { width: yesW = 200, height: yesH = 60 } = await sharp(yesBtnTemplate).metadata();

  const detail2 = await ctx.findImageWithLocation(detailUpgradeTemplate, 0.7);
  if (detail2.found) {
    // 识别到 detailUpgradeButton → 资源补完，回到训练界面
    ctx.log(`  资源补充完成，回到训练界面 (confidence: ${detail2.confidence.toFixed(3)})`);
    ctx.log('  点击训练按钮');
    await ctx.tap(TRAIN_BUTTON.x, TRAIN_BUTTON.y);
    await ctx.sleep(1);
    ctx.log(`=== ${targetBuilding} T${targetTier} 训练完成 ===`);
    return 'success';
  }
  ctx.log(`  未识别到 detailUpgradeButton (${detail2.confidence.toFixed(3)})`);

  // 未识别到 detailUpgradeButton → 有弹窗，判断弹窗类型
  ctx.log('  有弹窗，判断弹窗类型...');
  const yesRegion = await ctx.captureRegion(567, 611, yesW!, yesH!);
  const yesDiff = await ctx.compareImages(yesRegion, yesBtnTemplate);
  ctx.log(`  yesBtn 匹对差异: ${(yesDiff * 100).toFixed(1)}%`);
  await fs.unlink(yesRegion).catch(() => {});

  if (yesDiff < 0.3) {
    // 资源超出保护提示
    ctx.log('  资源超出保护提示，点击确认');
    await ctx.tap(567, 611);
    await ctx.sleep(1);
    ctx.log('  点击训练按钮');
    await ctx.tap(TRAIN_BUTTON.x, TRAIN_BUTTON.y);
    await ctx.sleep(1);
    ctx.log(`=== ${targetBuilding} T${targetTier} 训练完成 ===`);
    return 'success';
  }

  // 二次确认弹窗
  ctx.log('  二次确认弹窗，点击确认');
  const CONFIRM_BTN = { x: 803, y: 685 };
  await ctx.tap(CONFIRM_BTN.x, CONFIRM_BTN.y);
  await ctx.sleep(1);

  // 再次判断是否有资源超出保护提示
  const yesRegion2 = await ctx.captureRegion(567, 611, yesW!, yesH!);
  const yesDiff2 = await ctx.compareImages(yesRegion2, yesBtnTemplate);
  ctx.log(`  二次检测 yesBtn 匹对差异: ${(yesDiff2 * 100).toFixed(1)}%`);
  await fs.unlink(yesRegion2).catch(() => {});

  if (yesDiff2 < 0.3) {
    ctx.log('  资源超出保护提示，点击确认');
    await ctx.tap(567, 611);
    await ctx.sleep(1);
  }

  ctx.log('  点击训练按钮');
  await ctx.tap(TRAIN_BUTTON.x, TRAIN_BUTTON.y);
  await ctx.sleep(1);

  ctx.log(`=== ${targetBuilding} T${targetTier} 训练完成 ===`);
  return 'success';
}
