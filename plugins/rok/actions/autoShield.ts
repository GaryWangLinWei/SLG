import { PluginContext } from '../../../core/plugin';
import { getTemplatesDir } from '../../../core/resourcePath';
import { ensureBottomBarState } from '../utils/location';
import * as path from 'path';

const TEMPLATE_DIR = getTemplatesDir();
const HUDUN_ICON = path.join(TEMPLATE_DIR, 'icon_hudun.png');
const CANCEL_BTN = path.join(TEMPLATE_DIR, 'btn_cancel.png');

const ITEM_BUTTON = { x: 1037, y: 839 };       // 底部栏「道具」按钮
const BUFF_TAB = { x: 739, y: 103 };            // 道具面板「增益」页签
const USE_BUTTON = { x: 1229, y: 769 };         // 护盾详情「使用」按钮
const CLOSE_ITEM_PANEL = { x: 1392, y: 105 };   // 关闭道具面板

export type ShieldResult = 'success' | 'already_shielded' | 'no_shield' | 'bar_expand_failed' | 'bar_collapse_failed';

/**
 * 自动开盾流程：
 * 1) 展开底部栏
 * 2) 打开道具 → 切增益页签
 * 3) 找 icon_hudun.png：
 *    - 未找到 → 关闭面板 → 收回底部栏 → no_shield
 *    - 找到 → 点使用 → 判 btn_cancel.png（是否已在盾中）
 *      - 找到 cancel → tap 否 → already_shielded
 *      - 未找到 → success
 * 4) 关闭道具面板 → 收回底部栏
 */
export async function autoShield(ctx: PluginContext): Promise<ShieldResult> {
  ctx.log('=== 自动开盾 ===');

  // [1] 展开底部栏
  if (!(await ensureBottomBarState(ctx, 'expanded'))) {
    ctx.log('  ❌ 展开底部栏失败，放弃');
    return 'bar_expand_failed';
  }

  // [2] 打开道具面板
  ctx.log(`  点击道具按钮 (${ITEM_BUTTON.x}, ${ITEM_BUTTON.y})`);
  await ctx.tap(ITEM_BUTTON.x, ITEM_BUTTON.y);
  await ctx.sleep(1);

  // 切到增益页签
  ctx.log(`  切换到增益页签 (${BUFF_TAB.x}, ${BUFF_TAB.y})`);
  await ctx.tap(BUFF_TAB.x, BUFF_TAB.y);
  await ctx.sleep(0.8);

  // [3] 找护盾图标
  const hudun = await ctx.findImageWithLocation(HUDUN_ICON, 0.75);
  ctx.log(`  [护盾] found=${hudun.found} confidence=${hudun.confidence.toFixed(3)}`);

  let result: ShieldResult;
  if (!hudun.found) {
    ctx.log('  ⚠️ 未找到护盾');
    result = 'no_shield';
  } else {
    ctx.log(`  点击护盾图标 (${hudun.x}, ${hudun.y})`);
    await ctx.tap(hudun.x, hudun.y);
    await ctx.sleep(0.8);
    ctx.log(`  点击「使用」按钮 (${USE_BUTTON.x}, ${USE_BUTTON.y})`);
    await ctx.tap(USE_BUTTON.x, USE_BUTTON.y);
    await ctx.sleep(1);

    // 判断"是否继续使用"弹窗
    const cancel = await ctx.findImageWithLocation(CANCEL_BTN, 0.75);
    ctx.log(`  [取消按钮] found=${cancel.found} confidence=${cancel.confidence.toFixed(3)}`);
    if (cancel.found) {
      ctx.log(`  ⚠️ 已在盾中，点击「否」取消 (${cancel.x}, ${cancel.y})`);
      await ctx.tap(cancel.x, cancel.y);
      await ctx.sleep(0.8);
      result = 'already_shielded';
    } else {
      ctx.log('  ✅ 开盾成功');
      result = 'success';
    }
  }

  // [4] 关闭道具面板
  ctx.log(`  关闭道具面板 (${CLOSE_ITEM_PANEL.x}, ${CLOSE_ITEM_PANEL.y})`);
  await ctx.tap(CLOSE_ITEM_PANEL.x, CLOSE_ITEM_PANEL.y);
  await ctx.sleep(0.8);

  // 收回底部栏
  if (!(await ensureBottomBarState(ctx, 'collapsed'))) {
    ctx.log('  ⚠️ 收回底部栏失败');
    return 'bar_collapse_failed';
  }

  ctx.log(`=== 自动开盾结束: ${result} ===`);
  return result;
}
