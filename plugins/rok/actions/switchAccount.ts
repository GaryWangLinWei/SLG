import * as path from 'path';
import { PluginContext } from '../../../core/plugin';
import { getTemplatesDir } from '../../../core/resourcePath';
import { ocrService } from '../../../core/ocr/OcrService';
import { getCurrentLocation } from '../utils/location';
import { TAP_REGION } from './launchGame';

export type SwitchAccountResult = 'success' | 'not_found' | 'settings_failed' | 'load_timeout';

const AVATAR_TAP = { x: 58, y: 48 };          // (34,23)-(83,73) 中心
const SETTINGS_BTN = { x: 1358, y: 747 };     // (1329,719)-(1388,775) 中心
const SWITCH_BTN = { x: 727, y: 97 };
const DROPDOWN_BTN = { x: 994, y: 408 };
const LOGIN_BTN = { x: 802, y: 487 };

const REGION1 = { x: 676, y: 495, w: 862 - 676, h: 520 - 495, tap: { x: 769, y: 508 } };
const REGION2 = { x: 676, y: 569, w: 862 - 676, h: 594 - 569, tap: { x: 769, y: 582 } };

function randInt(min: number, max: number): number {
  return min + Math.floor(Math.random() * (max - min + 1));
}

/**
 * 切换游戏账号：头像 → 设置 → 账号 → 切换账号 → 展开下拉 → OCR 匹配 → 登录 → 等加载
 * @param targetName 目标账号编号（如 "241872258"），OCR 结果用 includes 匹配
 */
export async function switchAccount(ctx: PluginContext, targetName: string): Promise<SwitchAccountResult> {
  ctx.log(`=== 切换账号 target=${targetName} ===`);

  // 1. 点头像 → 打开用户中心边栏
  ctx.log(`  [1/6] 点头像 (${AVATAR_TAP.x}, ${AVATAR_TAP.y})`);
  await ctx.tap(AVATAR_TAP.x, AVATAR_TAP.y);
  await ctx.sleep(0.5);

  // 2. 点设置按钮 → 打开用户中心
  ctx.log(`  [2/6] 点设置按钮 (${SETTINGS_BTN.x}, ${SETTINGS_BTN.y})`);
  await ctx.tap(SETTINGS_BTN.x, SETTINGS_BTN.y);
  await ctx.sleep(1);

  // 3. 找账号按钮
  const iconAccountPath = path.join(getTemplatesDir(), 'icon_account.png');
  const accountIcon = await ctx.findImageWithLocation(iconAccountPath, 0.75);
  ctx.log(`  [3/6] icon_account.png found=${accountIcon.found} conf=${accountIcon.confidence.toFixed(3)}`);
  if (!accountIcon.found) {
    ctx.log('  ❌ 未找到账号图标，无法进入切号流程');
    return 'settings_failed';
  }
  await ctx.tap(accountIcon.x, accountIcon.y);
  await ctx.sleep(1);

  // 4. 点"切换账号"按钮
  ctx.log(`  [4/6] 点切换账号 (${SWITCH_BTN.x}, ${SWITCH_BTN.y})`);
  await ctx.tap(SWITCH_BTN.x, SWITCH_BTN.y);
  await ctx.sleep(1);

  // 5. 展开下拉 + OCR 匹配
  ctx.log(`  [5/6] 展开下拉 (${DROPDOWN_BTN.x}, ${DROPDOWN_BTN.y})`);
  await ctx.tap(DROPDOWN_BTN.x, DROPDOWN_BTN.y);
  await ctx.sleep(0.5);

  const region1Img = await ctx.captureRegion(REGION1.x, REGION1.y, REGION1.w, REGION1.h);
  const region2Img = await ctx.captureRegion(REGION2.x, REGION2.y, REGION2.w, REGION2.h);
  const [text1, text2] = await Promise.all([
    ocrService.readDigits(region1Img),
    ocrService.readDigits(region2Img),
  ]);
  ctx.log(`  [OCR] 区域1="${text1.trim()}" 区域2="${text2.trim()}"`);

  let tap: { x: number; y: number } | null = null;
  if (text1.includes(targetName)) tap = REGION1.tap;
  else if (text2.includes(targetName)) tap = REGION2.tap;

  if (!tap) {
    ctx.log(`  ⚠️ 未匹配到目标账号 ${targetName}`);
    return 'not_found';
  }

  ctx.log(`  匹配成功，点击 (${tap.x}, ${tap.y})`);
  await ctx.tap(tap.x, tap.y);
  await ctx.sleep(0.5);

  // 6. 点登录 + 等加载（与 launchGame 一致）
  ctx.log(`  [6/6] 点登录 (${LOGIN_BTN.x}, ${LOGIN_BTN.y})`);
  await ctx.tap(LOGIN_BTN.x, LOGIN_BTN.y);

  ctx.log(`  等待 15s 进入开始界面`);
  await ctx.sleep(15);

  const tx = randInt(TAP_REGION.x1, TAP_REGION.x2);
  const ty = randInt(TAP_REGION.y1, TAP_REGION.y2);
  ctx.log(`  点击 (${tx}, ${ty}) 进入游戏`);
  await ctx.tap(tx, ty);

  ctx.log(`  等待 20s 加载...`);
  await ctx.sleep(20);

  // 轮询城内 landmark 最多 60s，每 2s 一次
  ctx.log(`  每 2s 轮询进城，最多 60s`);
  const pollStart = Date.now();
  while (Date.now() - pollStart < 60_000) {
    await ctx.sleep(2);
    const loc = await getCurrentLocation(ctx);
    if (loc === 'city') {
      ctx.log(`  ✅ 已回到城内，切号成功`);
      return 'success';
    }
  }
  ctx.log(`  ❌ 60s 内未检测到城内界面`);
  return 'load_timeout';
}
