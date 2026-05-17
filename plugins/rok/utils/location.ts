import { PluginContext } from '../../../core/plugin';
import { RokConfig } from '../index';
import * as path from 'path';

const TEMPLATE_DIR = path.join(__dirname, '../templates');

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
 * 确保当前在城外。如果在城内则切换到城外。
 */
export async function ensureInWorld(ctx: PluginContext, config: RokConfig): Promise<void> {
  const location = await getCurrentLocation(ctx);
  if (location === 'world') {
    ctx.log('  [位置] 已在城外');
    return;
  }
  if (location === 'city') {
    ctx.log('  [位置] 在城内，切换到城外...');
    await ctx.tap(config.resourceCollect.worldSwitchButton.x, config.resourceCollect.worldSwitchButton.y);
    await ctx.sleep(2);
    return;
  }
  // unknown 状态，保险起见点一次切换
  ctx.log('  [位置] 状态未知，尝试切换...');
  await ctx.tap(config.resourceCollect.worldSwitchButton.x, config.resourceCollect.worldSwitchButton.y);
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
