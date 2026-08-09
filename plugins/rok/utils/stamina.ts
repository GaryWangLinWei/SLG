import { PluginContext } from '../../../core/plugin';
import { getTemplatesDir } from '../../../core/resourcePath';
import * as path from 'path';
import * as fsp from 'fs/promises';
import sharp from 'sharp';

export type StaminaColor = 'green' | 'yellow' | 'unknown';

export const STAMINA_BAR_RECT = { x1: 557, y1: 174, x2: 575, y2: 197 };
export const POTION_USE_BUTTON = { x: 1200, y: 326 };
export const CLOSE_STAMINA_POPUP = { x: 1363, y: 103 };
export const MAX_FREE_TILI_CLICKS = 2;
export const MAX_POTION_USES = 10;

export interface Rect { x: number; y: number; width: number; height: number; }

/** 根据平均 RGB 判定体力条颜色：绿/黄/未知 */
export function classifyStaminaColor(r: number, g: number, b: number): StaminaColor {
  if (g > r + 20 && g > b + 20) return 'green';
  if (r > 120 && g > 90 && Math.abs(r - g) < 60 && b < Math.min(r, g) - 40) return 'yellow';
  return 'unknown';
}

/** 采样体力条区域平均 RGB，判定绿/黄/未知 */
export async function readStaminaColor(ctx: PluginContext): Promise<StaminaColor> {
  let shot: string | null = null;
  try {
    shot = await ctx.captureRegion(
      STAMINA_BAR_RECT.x1, STAMINA_BAR_RECT.y1,
      STAMINA_BAR_RECT.x2 - STAMINA_BAR_RECT.x1,
      STAMINA_BAR_RECT.y2 - STAMINA_BAR_RECT.y1,
    );
    const { data, info } = await sharp(shot).removeAlpha().raw().toBuffer({ resolveWithObject: true });
    let sumR = 0, sumG = 0, sumB = 0;
    const pixels = info.width * info.height;
    for (let i = 0; i < data.length; i += 3) {
      sumR += data[i];
      sumG += data[i + 1];
      sumB += data[i + 2];
    }
    const r = sumR / pixels, g = sumG / pixels, b = sumB / pixels;
    ctx.log(`  [体力条] RGB=(${r.toFixed(0)},${g.toFixed(0)},${b.toFixed(0)})`);
    return classifyStaminaColor(r, g, b);
  } catch (e) {
    ctx.log(`  [体力条] 采样异常: ${(e as Error).message}`);
    return 'unknown';
  } finally {
    if (shot) await fsp.unlink(shot).catch(() => {});
  }
}

/** 循环点击 btn_tili 领取免费体力，最多 MAX_FREE_TILI_CLICKS 次或按钮消失 */
export async function claimAllFreeStamina(ctx: PluginContext, region: Rect): Promise<number> {
  const tpl = path.join(getTemplatesDir(), 'btn_tili.png');
  let claimed = 0;
  for (let i = 0; i < MAX_FREE_TILI_CLICKS; i++) {
    const btn = await ctx.findImageWithLocation(tpl, 0.8, [0.9, 1.0, 1.1], false, undefined, region);
    ctx.log(`  [体力] 免费按钮检测 #${i + 1}: found=${btn.found} conf=${btn.confidence.toFixed(3)}`);
    if (!btn.found) break;
    ctx.log(`  [体力] 点击免费按钮 (${btn.x}, ${btn.y})`);
    await ctx.tap(btn.x, btn.y);
    await ctx.sleep(0.8);
    claimed++;
  }
  return claimed;
}

/**
 * 点击行军并根据行动力不足弹窗自动领免费体力/用药水，失败重试一次。
 * marchTap：点击行军按钮的动作，回调只执行点击（含点击后立即出现的二次确认，如胜算不足 surego），
 *   不要在回调里加行军后的 settle 延迟——工具会在回调返回后统一等待 1s 再检测切换按钮等结果。
 * closePopupAndCity：关闭弹窗并回城的兜底动作。
 * 返回 'marched' 表示行军已发起，'insufficient' 表示体力不足已回城。
 */
export async function handleMarchWithStamina(
  ctx: PluginContext,
  tiliRegion: Rect,
  usePotion: boolean,
  marchTap: () => Promise<void>,
  closePopupAndCity: () => Promise<void>,
): Promise<'marched' | 'insufficient'> {
  const switchInCityTpl = path.join(getTemplatesDir(), 'switch_in_city.png');
  const switchInWorldTpl = path.join(getTemplatesDir(), 'switch_in_world.png');

  for (let marchAttempt = 1; marchAttempt <= 2; marchAttempt++) {
    await ctx.sleep(0.5);
    await marchTap();
    await ctx.sleep(1);

    const switchCityResult = await ctx.findImageWithLocation(switchInCityTpl, 0.7);
    const switchWorldResult = await ctx.findImageWithLocation(switchInWorldTpl, 0.7);
    ctx.log(`  切换按钮: city=${switchCityResult.found ? switchCityResult.confidence.toFixed(3) : 'not found'}, world=${switchWorldResult.found ? switchWorldResult.confidence.toFixed(3) : 'not found'}`);
    const isStaminaInsufficient = !switchCityResult.found && !switchWorldResult.found;
    if (!isStaminaInsufficient) {
      return 'marched';
    }

    ctx.log(`  ⚠️ 切换按钮不可见 → 行动力不足弹窗`);

    if (marchAttempt >= 2) {
      await closePopupAndCity();
      return 'insufficient';
    }

    const claimed = await claimAllFreeStamina(ctx, tiliRegion);
    ctx.log(`  [体力] 免费领取 ${claimed} 次`);

    const color = await readStaminaColor(ctx);
    ctx.log(`  [体力] 判定颜色: ${color}`);

    if (color === 'green') {
      ctx.log(`  [体力] 充足 → 关闭弹窗重试行军`);
      await ctx.tap(CLOSE_STAMINA_POPUP.x, CLOSE_STAMINA_POPUP.y);
      await ctx.sleep(0.8);
      continue;
    }

    if (color === 'yellow' && usePotion) {
      let becameGreen = false;
      for (let i = 0; i < MAX_POTION_USES; i++) {
        ctx.log(`  [体力] 使用药水 #${i + 1} → (${POTION_USE_BUTTON.x}, ${POTION_USE_BUTTON.y})`);
        await ctx.tap(POTION_USE_BUTTON.x, POTION_USE_BUTTON.y);
        await ctx.sleep(0.9);
        const c = await readStaminaColor(ctx);
        if (c === 'green') { becameGreen = true; break; }
      }
      if (becameGreen) {
        ctx.log(`  [体力] 药水补至绿 → 关闭弹窗重试行军`);
        await ctx.tap(CLOSE_STAMINA_POPUP.x, CLOSE_STAMINA_POPUP.y);
        await ctx.sleep(0.8);
        continue;
      }
      ctx.log(`  [体力] 药水用尽仍未转绿 → 放弃`);
    } else {
      ctx.log(`  [体力] 不足（color=${color}, usePotion=${usePotion}）→ 放弃`);
    }

    await closePopupAndCity();
    return 'insufficient';
  }

  // 理论上不可达：循环内要么 return marched，要么第二次失败 return insufficient
  return 'insufficient';
}
