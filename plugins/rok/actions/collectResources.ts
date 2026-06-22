import { PluginContext } from '../../../core/plugin';
import { RokConfig } from '../index';
import { getTemplatesDir } from '../../../core/resourcePath';
import { resetCityView } from '../utils/location';
import * as path from 'path';

const TEMPLATE_DIR = getTemplatesDir();

// collect 模板目录下的 8 张资源收集图标，按资源类型分组（点一项会收掉所有同类）
const COLLECT_GROUPS: Record<string, string[]> = {
  food: ['collect_food.png', 'collect_food_full.png'],
  gold: ['collect_gold.png', 'collect_gold_full.png'],
  stone: ['collect_stone.png', 'collect_stone_full.png'],
  wood: ['collect_wood.png', 'collect_wood_full.png'],
};
const COLLECT_GROUP_PATHS: Record<string, string[]> = Object.fromEntries(
  Object.entries(COLLECT_GROUPS).map(([type, names]) => [
    type,
    names.map(name => path.join(TEMPLATE_DIR, 'collect', name)),
  ])
);;

// 检索区域：(0,54)-(1600,900)
const SEARCH_REGION = { x: 0, y: 54, width: 1600, height: 846 };

// 聊天区域（左下角），命中此区域的图标忽略
const CHAT_ZONE = { x1: 0, x2: 814, y1: 794, y2: 900 };

const COLLECT_THRESHOLD = 0.8;
const COLLECT_SCALES = [0.75, 1.0];
const MAX_ROUNDS = 30;

/**
 * 命中点是否落在左下角聊天区域。
 */
export function isInCollectChatZone(x: number, y: number): boolean {
  return x >= CHAT_ZONE.x1 && x <= CHAT_ZONE.x2 && y >= CHAT_ZONE.y1 && y <= CHAT_ZONE.y2;
}

export async function collectResources(
  ctx: PluginContext,
  config: RokConfig
): Promise<void> {
  ctx.log('=== 开始收集城内资源 ===');

  // 1. 重置城内视角
  await resetCityView(ctx, config);

  // 2. 循环：每轮按资源类型各点一个（点一项会收掉所有同类），点完所有类型后重新检索，直到全部检索不到
  for (let round = 1; round <= MAX_ROUNDS; round++) {
    let clicked = 0;
    for (const [type, paths] of Object.entries(COLLECT_GROUP_PATHS)) {
      const matches = await ctx.findAllImagesMultiTemplate(paths, COLLECT_THRESHOLD, COLLECT_SCALES);
      const valid = matches.filter(m =>
        m.x >= SEARCH_REGION.x && m.x <= SEARCH_REGION.x + SEARCH_REGION.width &&
        m.y >= SEARCH_REGION.y && m.y <= SEARCH_REGION.y + SEARCH_REGION.height &&
        !isInCollectChatZone(m.x, m.y)
      );
      if (valid.length === 0) continue;

      const target = valid.sort((a, b) => b.confidence - a.confidence)[0];
      ctx.log(`第 ${round} 轮 [${type}] 点击 (${target.x}, ${target.y}) confidence: ${target.confidence.toFixed(3)}`);
      await ctx.tap(target.x, target.y);
      await ctx.sleep(1.2);
      clicked++;
    }

    if (clicked === 0) {
      ctx.log(`第 ${round} 轮未检索到任何资源图标，收集结束`);
      break;
    }
  }

  ctx.log('=== 城内资源收集完成 ===');
}
