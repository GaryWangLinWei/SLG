import { PluginContext } from '../../../core/plugin';
import { RokConfig } from '../index';
import { resetCityView } from '../utils/location';
import { getTemplatesDir } from '../../../core/resourcePath';
import * as path from 'path';
import * as fs from 'fs/promises';
import sharp from 'sharp';

const TEMPLATE_DIR = getTemplatesDir();

// 科技名称到模板文件名的映射
export const TECH_TEMPLATES: Record<string, string> = {
  // === 经济科技 ===
  '采石': 'tech_caishi.png',
  '灌溉': 'tech_guangai.png',
  '手锯': 'tech_shouju.png',
  '镰刀': 'tech_liandao.png',
  '石工术': 'tech_shigongshu.png',
  '手斧': 'tech_shoufu.png',
  '冶金术': 'tech_yejinshu.png',
  '凿子': 'tech_zaozi.png',
  '文字': 'tech_wenzi.png',
  '金属加工': 'tech_jinshujiagong.png',
  '手推车': 'tech_shoutuiche.png',
  '多层建筑': 'tech_duocengjianzhu.png',
  '砂矿开采法': 'tech_shakuangcaifa.png',
  '车轮': 'tech_chelun.png',
  '珠宝': 'tech_zhubao.png',
  '耕犁': 'tech_plow.png',
  '锯木厂': 'tech_sawmill.png',
  '长柄大镰刀': 'tech_changbingdalindao.png',
  '工程学': 'tech_gongchengxue.png',
  '双人粗木锯': 'tech_shuangrencunmuju.png',
  '数学': 'tech_shuxue.png',
  '露天采石场': 'tech_lutiancaishichang.png',
  '铸币': 'tech_coin.png',
  '石锯': 'tech_shiju.png',
  '机械': 'tech_jiXie.png',
  '竖井开采法': 'tech_shujingcaifa.png',
  '辎重马车': 'tech_zizhongmache.png',
  '切割抛光工艺': 'tech_qiegepaoguang.png',
  // === 军事科技 ===
  '炼铁术': 'tech_liantieshu.png',
  '箭羽改良': 'tech_jianyugailiang.png',
  '骑术': 'tech_qishu.png',
  '燃烧弹': 'tech_ranshaodan.png',
  '剑士': 'tech_jianshi.png',
  '弓箭手': 'tech_gongjianshou.png',
  '轻骑兵': 'tech_qingqibing.png',
  '床弩': 'tech_chuangnu.png',
  '追踪术': 'tech_zhuizongshu.png',
  '寻路术': 'tech_xunlushu.png',
  '小圆盾': 'tech_xiaoyuandun.png',
  '皮甲': 'tech_pijia.png',
  '鳞甲': 'tech_linjia.png',
  '轮轴强化': 'tech_lunzhouqianghua.png',
  '枪兵': 'tech_qiangbing.png',
  '复合弓手': 'tech_fuhegongshou.png',
  '重骑兵': 'tech_zhongqibing.png',
  '投石车': 'tech_toushiche.png',
  '伪装术': 'tech_weizhuangshu.png',
  '战斗策略': 'tech_zhandoucelue.png',
  '防御阵型': 'tech_fangyuzhenxing.png',
  '草药':'tech_caoyao.png',
  '制图学': 'tech_zhituxue.png',
  '长剑士': 'tech_changjianshi.png',
  '弩手': 'tech_nushou.png',
  '骑士': 'tech_qishi.png',
  '弩炮': 'tech_nupao.png',
  '乌兹钢': 'tech_wuzigang.png',
  '锥形箭': 'tech_zhuixingjian.png',
  '马镫': 'tech_madeng.png',
  '弹道学': 'tech_dandaoxue.png',
  '长鳞盾': 'tech_changlindun.png',
  '巨盾': 'tech_judun.png',
  '板甲': 'tech_banjia.png',
  '重型车架': 'tech_zhongxingchejia.png',
  '医疗部队': 'tech_yiliaobudui.png',
  '联合作战': 'tech_lianhezuozhan.png',
  '扎营防守': 'tech_zhayingfangshou.png',
  '禁卫军': 'tech_jinweijun.png',
  '皇家弩手': 'tech_huangjianushou.png',
  '皇家骑士': 'tech_huangjiaqishi.png',
  '抛石机': 'tech_paoshiji.png',
};

// 经济科技
export const ECONOMIC_TECHS = new Set([
  '采石', '灌溉', '手锯', '镰刀', '石工术', '手斧', '冶金术', '凿子',
  '文字', '金属加工', '手推车', '多层建筑', '砂矿开采法', '车轮', '珠宝',
  '耕犁', '锯木厂', '长柄大镰刀', '工程学', '双人粗木锯', '数学',
  '露天采石场', '铸币', '石锯', '机械', '竖井开采法', '辎重马车', '切割抛光工艺',
]);

// 军事科技
export const MILITARY_TECHS = new Set([
  '炼铁术', '箭羽改良', '骑术', '燃烧弹', '剑士', '弓箭手', '轻骑兵', '床弩',
  '追踪术', '寻路术', '小圆盾', '皮甲', '鳞甲', '轮轴强化', '枪兵', '复合弓手',
  '重骑兵', '投石车', '伪装术', '战斗策略', '防御阵型', '医疗部队', '制图学',
  '长剑士', '弩手', '骑士', '弩炮', '乌兹钢', '锥形箭', '马镫', '弹道学',
  '长鳞盾', '巨盾', '板甲', '重型车架', '联合作战', '扎营防守', '禁卫军',
  '皇家弩手', '皇家骑士', '抛石机',
]);

// 科技页签坐标
const ECONOMIC_TAB = { x: 107, y: 225 };
const MILITARY_TAB = { x: 108, y: 376 };

export type ResearchResult = 'success' | 'busy' | 'not_found' | 'no_research_button' | 'lack_resources';

export async function researchTech(
  ctx: PluginContext,
  config: RokConfig,
  targetTech: string,
  researchBuilding?: string,
  skipBusyCheck?: boolean
): Promise<ResearchResult> {
  const buildingName = researchBuilding || config.techResearch.researchBuilding;
  if (!buildingName) {
    ctx.log('❌ 未指定研究建筑，请在首页勾选自动研究后选择对应的建筑');
    return 'not_found';
  }
  ctx.log(`=== 开始研究科技: ${targetTech} (建筑: ${buildingName}) ===`);

  const templateFile = TECH_TEMPLATES[targetTech];
  if (!templateFile) {
    ctx.log(`❌ 不支持的科技: ${targetTech}`);
    return 'not_found';
  }

  const techTemplatePath = path.join(TEMPLATE_DIR, templateFile);
  ctx.log(`使用识别模板: ${templateFile}`);

  // ============================================
  // 第 0 步: 重置城内视角
  // ============================================
  await resetCityView(ctx, config);

  // ============================================
  // 第 1 步: 点击学院建筑
  // ============================================
  const academyPos = config.buildingPositions[buildingName];
  if (!academyPos) {
    ctx.log(`❌ 未找到建筑坐标: ${buildingName}`);
    return 'not_found';
  }
  ctx.log(`--- 第 1 步: 拖动 ${buildingName} 到屏幕中心 (${academyPos.x}, ${academyPos.y} → 800, 450) ---`);
  await ctx.swipe(academyPos.x, academyPos.y, 800, 450, 1000);
  await ctx.tap(800, 450);  // 打断惯性
  await ctx.sleep(0.3);
  await ctx.tap(800, 450);
  await ctx.sleep(0.5);
  await ctx.tap(800, 450);
  await ctx.sleep(1);

  // ============================================
  // 第 2 步: 识别弹出研究按钮，进入研究面板
  // 首次用图像识别，识别到后缓存坐标，后续直接用缓存（同一循环内有效）
  // ============================================
  ctx.log('--- 第 2 步: 获取弹出研究按钮坐标 ---');
  const POP_SEARCH_KEY = 'pop_SearchBtn';
  let popupX: number;
  let popupY: number;

  const cached = ctx.getCachedLocation(POP_SEARCH_KEY);
  if (cached) {
    popupX = cached.x;
    popupY = cached.y;
    ctx.log(`使用缓存的弹出研究按钮坐标 (${popupX}, ${popupY})`);
  } else {
    const popSearchTemplate = path.join(TEMPLATE_DIR, 'pop_SearchBtn.png');
    const popup = await ctx.findImageWithLocation(popSearchTemplate, 0.7, [0.7, 0.8, 0.9, 1.0, 1.1]);
    if (!popup.found) {
      ctx.log(`❌ 未找到弹出研究按钮 (confidence: ${popup.confidence.toFixed(3)})`);
      return 'no_research_button';
    }
    popupX = popup.x;
    popupY = popup.y;
    ctx.setCachedLocation(POP_SEARCH_KEY, popupX, popupY);
    ctx.log(`识别并缓存弹出研究按钮 (${popupX}, ${popupY})`);
  }
  await ctx.tap(popupX, popupY);
  await ctx.sleep(2);

  // ============================================
  // 第 2.5 步: 检测是否有科技正在研究中
  // ============================================
  if (!skipBusyCheck) {
    ctx.log('--- 第 2.5 步: 检测是否有科技正在研究中 ---');
    const cancelTemplate = path.join(TEMPLATE_DIR, 'btn_cancel_research.png');
    const { width: cancelW = 120, height: cancelH = 50 } = await sharp(cancelTemplate).metadata();
    const cancelRegion = await ctx.captureRegion(
      584 - Math.floor(cancelW! / 2),
      157 - Math.floor(cancelH! / 2),
      cancelW!, cancelH!
    );

    const cancelDiff = await ctx.compareImages(cancelRegion, cancelTemplate);
    ctx.log(`  取消按钮匹对差异: ${(cancelDiff * 100).toFixed(1)}%`);

    if (cancelDiff < 0.3) {
      ctx.log('  ⏳ 已有科技正在研究中，关闭详情并结束');
      await ctx.tap(1395, 88);
      await ctx.sleep(1);
      return 'busy';
    }
    ctx.log('  队列空闲，继续研究');
  }

  // ============================================
  // 第 2.6 步: 判断科技类别，点击对应页签
  // ============================================
  if (ECONOMIC_TECHS.has(targetTech)) {
    ctx.log(`--- 第 2.6 步: ${targetTech} 是经济科技，点击经济页签 (${ECONOMIC_TAB.x}, ${ECONOMIC_TAB.y}) ---`);
    await ctx.tap(ECONOMIC_TAB.x, ECONOMIC_TAB.y);
  } else if (MILITARY_TECHS.has(targetTech)) {
    ctx.log(`--- 第 2.6 步: ${targetTech} 是军事科技，点击军事页签 (${MILITARY_TAB.x}, ${MILITARY_TAB.y}) ---`);
    await ctx.tap(MILITARY_TAB.x, MILITARY_TAB.y);
  } else {
    ctx.log(`  ⚠️ ${targetTech} 不在经济/军事科技列表中，跳过页签点击`);
  }
  await ctx.sleep(1);

  // ============================================
  // 第 3 步: 在面板中滑动寻找目标科技
  // ============================================
  ctx.log('--- 第 3 步: 滑动寻找目标科技 ---');
  const maxPages = 5;
  let techFound = false;

  for (let page = 0; page < maxPages; page++) {
    ctx.log(`扫描第 ${page + 1} 页...`);

    // 用图像识别找科技
    const found = await ctx.tapImage(techTemplatePath, 0.65);
    if (found) {
      ctx.log(`✅ 找到科技: ${targetTech}`);
      techFound = true;
      break;
    }

    // 没找到，向左滑动
    if (page < maxPages - 1) {
      ctx.log('当前页未找到，向左滑动...');
      await ctx.swipe(
        config.techResearch.swipeFromX,
        config.techResearch.swipeY,
        config.techResearch.swipeToX,
        config.techResearch.swipeY,
        850
      );
      await ctx.sleep(1.5);
    }
  }

  if (!techFound) {
    ctx.log(`❌ 滑动 ${maxPages} 页后仍未找到科技: ${targetTech}`);
    ctx.log('正在返回主界面...');
    await ctx.tap(config.backButton.x, config.backButton.y);
    await ctx.sleep(1);
    return 'not_found';
  }

  // ============================================
  // 第 4 步: 等待科技升级详情页加载
  // ============================================
  ctx.log('--- 第 4 步: 进入科技升级详情页 ---');
  await ctx.sleep(2);

  // ============================================
  // 第 5 步: 图像确认在详情页，然后点击研究按钮
  // ============================================
  ctx.log('--- 第 5 步: 确认详情页并点击研究 ---');
  const detailUpgradeTemplate = path.join(TEMPLATE_DIR, 'detailUpgradeButton.png');
  const { width: detailW = 200, height: detailH = 60 } = await sharp(detailUpgradeTemplate).metadata();

  const detail = await ctx.findImageWithLocation(detailUpgradeTemplate, 0.7);
  if (!detail.found) {
    ctx.log(`  [5] ⚠ 未找到详情升级按钮 (${detail.confidence.toFixed(3)})，点击2次返回`);
    await ctx.tap(config.backButton.x, config.backButton.y);
    await ctx.sleep(1);
    await ctx.tap(config.backButton.x, config.backButton.y);
    await ctx.sleep(1);
    return 'no_research_button';
  }
  ctx.log(`  [5] 点击研究按钮 (${config.techResearch.detailResearchButton.x}, ${config.techResearch.detailResearchButton.y})`);
  await ctx.tap(config.techResearch.detailResearchButton.x, config.techResearch.detailResearchButton.y);
  await ctx.sleep(1.5);

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
    // 无弹窗，研究成功
    ctx.log('=== 科技研究操作完成 ===');
    await ctx.tap(config.backButton.x, config.backButton.y);
    await ctx.sleep(1);

    ctx.log(`  请求盟友帮助 — 点击 ${buildingName} (800, 450)`);
    await ctx.tap(800, 450);
    await ctx.sleep(0.5);
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
    // 识别到 detailUpgradeButton → 资源补完，回到详情页
    ctx.log(`  资源补充完成，回到详情页 (confidence: ${detail2.confidence.toFixed(3)})`);
    ctx.log(`  点击研究按钮 (${config.techResearch.detailResearchButton.x}, ${config.techResearch.detailResearchButton.y})`);
    await ctx.tap(config.techResearch.detailResearchButton.x, config.techResearch.detailResearchButton.y);
    await ctx.sleep(1.5);
    ctx.log('=== 科技研究操作完成 ===');
    await ctx.tap(config.backButton.x, config.backButton.y);
    await ctx.sleep(1);

    ctx.log(`  请求盟友帮助 — 点击 ${buildingName} (800, 450)`);
    await ctx.tap(800, 450);
    await ctx.sleep(0.5);
    return 'success';
  }

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
    ctx.log(`  点击研究按钮 (${config.techResearch.detailResearchButton.x}, ${config.techResearch.detailResearchButton.y})`);
    await ctx.tap(config.techResearch.detailResearchButton.x, config.techResearch.detailResearchButton.y);
    await ctx.sleep(1.5);
    ctx.log('=== 科技研究操作完成 ===');
    await ctx.tap(config.backButton.x, config.backButton.y);
    await ctx.sleep(1);

    ctx.log(`  请求盟友帮助 — 点击 ${buildingName} (800, 450)`);
    await ctx.tap(800, 450);
    await ctx.sleep(0.5);
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

  ctx.log(`  点击研究按钮 (${config.techResearch.detailResearchButton.x}, ${config.techResearch.detailResearchButton.y})`);
  await ctx.tap(config.techResearch.detailResearchButton.x, config.techResearch.detailResearchButton.y);
  await ctx.sleep(1.5);

  ctx.log('=== 科技研究操作完成 ===');
  await ctx.tap(config.backButton.x, config.backButton.y);
  await ctx.sleep(1);
  ctx.log(`  请求盟友帮助 — 点击 ${buildingName} (800, 450)`);
  await ctx.tap(800, 450);
  await ctx.sleep(0.5);
  return 'success';
}
