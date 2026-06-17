import { PluginContext } from '../../../core/plugin';
import { RokConfig } from '../index';
import { getTemplatesDir } from '../../../core/resourcePath';
import * as path from 'path';
import sharp from 'sharp';

const TEMPLATE_DIR = getTemplatesDir();

// ============================================
// 拖动建筑到屏幕中心（惯性衰减补偿 + 边缘避让）
// ============================================

const SCREEN_W = 1600;
const SCREEN_H = 900;
const EDGE_DANGER = 160;  // 屏幕边缘危险区域（UI 层叠加范围）
const EDGE_OFFSET = 60;   // 边缘避让偏移量

// 分段 swipe 因段间松手重按抑制惯性 + 段尾位移丢失，实测到位约 88%。
// GAIN 把位移放大，让画面惯性停下后正好落在 (800, 450)。
// 基于实测 (479,835)→中心 的到位率 0.88 标定。
const SWIPE_GAIN = 1.135;

/**
 * 计算边缘避让偏移量。
 * 建筑在屏幕边缘 160px 内时，叠加 60px 偏移推动触摸起点离开 UI 层。
 */
function getEdgeOffset(x: number, y: number): { ox: number; oy: number } {
  let ox = 0, oy = 0;
  if (x < EDGE_DANGER) ox = EDGE_OFFSET;
  else if (x > SCREEN_W - EDGE_DANGER) ox = -EDGE_OFFSET;
  if (y < EDGE_DANGER) oy = EDGE_OFFSET;
  else if (y > SCREEN_H - EDGE_DANGER) oy = -EDGE_OFFSET;
  return { ox, oy };
}

/**
 * 拖动建筑到屏幕中心并点击选中。
 *
 * 1. 边缘避让：建筑在屏幕边缘 160px 内时，swipe 起点和终点叠加相同偏移，
 *    触摸起点避开 UI 层（底部聊天框/右侧队伍栏等）。相对位移不变。
 * 2. 惯性补偿：分段 swipe 有 ~12% 欠拖，把位移放大 GAIN 倍，让画面惯性停下后落到 (800, 450)。
 *
 * 点击仍点 (800, 450) 选中建筑。
 */
export async function swipeBuildingToCenter(
  ctx: PluginContext,
  buildPos: { x: number; y: number },
  label?: string
): Promise<void> {
  const { ox, oy } = getEdgeOffset(buildPos.x, buildPos.y);

  // 补偿后的位移终点（相对起点放大 GAIN 倍）
  const ex = Math.round(800 + (800 - buildPos.x) * (SWIPE_GAIN - 1));
  const ey = Math.round(450 + (450 - buildPos.y) * (SWIPE_GAIN - 1));

  // 起点终点叠加相同边缘偏移，相对位移不变
  const sx = buildPos.x + ox;
  const sy = buildPos.y + oy;
  const tx = ex + ox;
  const ty = ey + oy;

  const name = label || '建筑';
  if (ox !== 0 || oy !== 0) {
    ctx.log(`  拖动 ${name} 到屏幕中心 (${buildPos.x},${buildPos.y} offset=${ox},${oy} → swipe ${sx},${sy}→${tx},${ty} 补偿${SWIPE_GAIN})`);
  } else {
    ctx.log(`  拖动 ${name} 到屏幕中心 (${buildPos.x},${buildPos.y} → swipe终点 ${ex},${ey} 补偿${SWIPE_GAIN})`);
  }

  await ctx.swipe(sx, sy, tx, ty, 1000);
  await ctx.tap(800, 450);  // 打断惯性
  await ctx.sleep(0.3);
  await ctx.tap(800, 450);
  await ctx.sleep(0.5);
  await ctx.tap(800, 450);
  await ctx.sleep(1);
}

// 切换按钮区域配置（中心点 + 区域大小）
const SWITCH_BUTTON_REGION = {
  centerX: 82,
  centerY: 814,
  width: 60,
  height: 60,
};

const LOCATION_TEMPLATES = {
  city: path.join(TEMPLATE_DIR, 'switch_in_city.png'),
  world: path.join(TEMPLATE_DIR, 'switch_in_world.png'),
};

// 底部栏展开状态检测：检测弹出的菜单项来判断是否展开
const BOTTOM_BAR_TEMPLATE = path.join(TEMPLATE_DIR, 'pop_mailBtn.png');
const BOTTOM_BAR_CHECK = { x: 1410, y: 837 };
const BOTTOM_BAR_COLLAPSE = { x: 1539, y: 837 };

export type Location = 'city' | 'world' | 'unknown';

/**
 * 检测当前在城内还是城外
 * 通过对比城内城外切换按钮的样式确定
 */
export async function getCurrentLocation(ctx: PluginContext): Promise<Location> {
  const regionX = SWITCH_BUTTON_REGION.centerX - Math.floor(SWITCH_BUTTON_REGION.width / 2);
  const regionY = SWITCH_BUTTON_REGION.centerY - Math.floor(SWITCH_BUTTON_REGION.height / 2);

  const result = await ctx.detectState(
    regionX,
    regionY,
    SWITCH_BUTTON_REGION.width,
    SWITCH_BUTTON_REGION.height,
    LOCATION_TEMPLATES,
    0.6
  );

  ctx.log(`  [位置检测] 当前=${result.state}, 差异 city=${(result.diffs.city * 100).toFixed(1)}%, world=${(result.diffs.world * 100).toFixed(1)}%`);
  return result.state as Location;
}

/**
 * 确保当前在城外，并重置城外视角。
 * - 如果在城内：切换到城外
 * - 如果已在城外：点2次切换（回城→出城），重置视角到默认位置
 */
export async function ensureInWorld(ctx: PluginContext, config: RokConfig): Promise<void> {
  const { x, y } = config.resourceCollect.worldSwitchButton;
  const location = await getCurrentLocation(ctx);
  if (location === 'world') {
    ctx.log('  [位置] 已在城外，重置视角...');
    await ctx.tap(x, y);
    await ctx.sleep(1.5);
    await ctx.tap(x, y);
    await ctx.sleep(2);
    return;
  }
  if (location === 'city') {
    ctx.log('  [位置] 在城内，切换到城外...');
    await ctx.tap(x, y);
    await ctx.sleep(2);
    return;
  }
  // unknown 状态，保险起见点两次切换
  ctx.log('  [位置] 状态未知，尝试切换...');
  await ctx.tap(x, y);
  await ctx.sleep(1.5);
  await ctx.tap(x, y);
  await ctx.sleep(2);
}

/**
 * 重置城内视角：切到城外再切回来，重置摄像机到默认位置。
 * 先判断当前在城内还是城外，减少不必要的操作。
 */
export async function resetCityView(ctx: PluginContext, config: RokConfig): Promise<void> {
  const { x, y } = config.resourceCollect.worldSwitchButton;
  const location = await getCurrentLocation(ctx);
  if (location === 'world') {
    ctx.log(`  已在城外，直接切回城内 (${x}, ${y})`);
    await ctx.tap(x, y);
    await ctx.sleep(2);
  } else {
    ctx.log(`  重置城内视角 (${x}, ${y})`);
    await ctx.tap(x, y);
    await ctx.sleep(1);
    await ctx.tap(x, y);
    await ctx.sleep(2);
  }
}

/**
 * 确保当前在城内。如果在城外则切换到城内。
 */
export async function ensureInCity(ctx: PluginContext, config: RokConfig): Promise<void> {
  const location = await getCurrentLocation(ctx);
  if (location === 'city') {
    ctx.log('  [位置] 已在城内');
    return;
  }
  if (location === 'world') {
    ctx.log('  [位置] 在城外，切换到城内...');
    await ctx.tap(config.resourceCollect.worldSwitchButton.x, config.resourceCollect.worldSwitchButton.y);
    await ctx.sleep(2);
    return;
  }
  ctx.log('  [位置] 状态未知，尝试切换...');
  await ctx.tap(config.resourceCollect.worldSwitchButton.x, config.resourceCollect.worldSwitchButton.y);
  await ctx.sleep(2);
}

/**
 * 确保底部栏已收回。如果检测到底部栏展开则点击回收按钮。
 * 这个判断每次运行只做一次，通过 PluginContext 的 bottomBarChecked 标记。
 */
export async function ensureBottomBarCollapsed(ctx: PluginContext): Promise<void> {
  // @ts-ignore
  if (ctx.bottomBarChecked) {
    ctx.log('  [底部栏] 已检测过，跳过');
    return;
  }

  try {
    ctx.log(`  [底部栏] 开始检测，模板: ${BOTTOM_BAR_TEMPLATE}`);

    const { width: tplW, height: tplH } = await sharp(BOTTOM_BAR_TEMPLATE).metadata();
    ctx.log(`  [底部栏] 模板尺寸: ${tplW}x${tplH}`);

    const left = BOTTOM_BAR_CHECK.x - Math.floor(tplW! / 2);
    const top = BOTTOM_BAR_CHECK.y - Math.floor(tplH! / 2);
    ctx.log(`  [底部栏] 截取区域: (${left}, ${top}, ${tplW}, ${tplH})`);

    const regionPath = await ctx.captureRegion(left, top, tplW!, tplH!);
    const diff = await ctx.compareImages(regionPath, BOTTOM_BAR_TEMPLATE);
    ctx.log(`  [底部栏] 菜单匹配度: ${(diff * 100).toFixed(1)}%`);

    if (diff < 0.3) {
      ctx.log(`  [底部栏] 检测到菜单展开，点击收回 (${BOTTOM_BAR_COLLAPSE.x}, ${BOTTOM_BAR_COLLAPSE.y})`);
      await ctx.tap(BOTTOM_BAR_COLLAPSE.x, BOTTOM_BAR_COLLAPSE.y);
      await ctx.sleep(0.5);
    } else {
      ctx.log('  [底部栏] 已处于收回状态');
    }
  } catch (e: any) {
    ctx.log(`  [底部栏] 检测出错: ${e.message || e}`);
  }

  // @ts-ignore
  ctx.bottomBarChecked = true;
}
