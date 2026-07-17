import { PluginContext } from '../../../core/plugin';

// UI 坐标（1600x900）
export const COORD_ENTRY_BUTTON = { x: 552, y: 26 };
export const X_INPUT_BOX        = { x: 799, y: 176 };
export const Y_INPUT_BOX        = { x: 987, y: 178 };
export const COORD_SEARCH_BTN   = { x: 1108, y: 180 };

function rand(lo: number, hi: number): number {
  return lo + Math.random() * (hi - lo);
}

async function typeDigitsLikeHuman(ctx: PluginContext, value: number): Promise<void> {
  const digits = String(value);
  for (let i = 0; i < digits.length; i++) {
    await ctx.inputText(digits[i]);
    if (i < digits.length - 1) await ctx.sleep(rand(0.08, 0.2));
  }
}

/**
 * 通过弹出的坐标输入框跳到 (x, y) 坐标。
 * 调用前需保证已经在城外视角。
 */
export async function locateByCoord(ctx: PluginContext, x: number, y: number): Promise<void> {
  ctx.log(`[定位] 坐标 (${x},${y})`);
  await ctx.tap(COORD_ENTRY_BUTTON.x, COORD_ENTRY_BUTTON.y);
  await ctx.sleep(rand(0.9, 1.4));
  await ctx.tap(X_INPUT_BOX.x, X_INPUT_BOX.y);
  await ctx.sleep(rand(0.4, 0.8));
  await typeDigitsLikeHuman(ctx, x);
  await ctx.sleep(rand(0.25, 0.55));
  await ctx.tap(Y_INPUT_BOX.x, Y_INPUT_BOX.y);
  await ctx.sleep(rand(0.4, 0.8));
  await typeDigitsLikeHuman(ctx, y);
  await ctx.sleep(rand(0.25, 0.55));
  await ctx.tap(COORD_SEARCH_BTN.x, COORD_SEARCH_BTN.y);
  await ctx.sleep(rand(1.3, 1.9));
}
