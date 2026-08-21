import * as path from 'path';
import { PluginContext } from '../../../core/plugin';
import { getTemplatesDir } from '../../../core/resourcePath';
import { waitForCityAfterLogin } from './switchAccount';

export type SwitchRoleResult =
  | 'success'
  | 'already_active'          // 目标角色已是当前角色，点击无效果
  | 'not_found'
  | 'invalid_index'
  | 'switched_load_timeout';

const AVATAR_TAP = { x: 63, y: 51 };
const SETTINGS_BTN = { x: 1358, y: 743 };
const CLOSE_ROLE_BTN = { x: 1366, y: 105 };
const CLOSE_SETTINGS_BTN = { x: 1394, y: 55 };
const CLOSE_PLAYER_BTN = { x: 1454, y: 88 };

/** 角色管理网格：2 列 × 3 行，每屏 6 格。列 x 沿用旧实现已验证值，行间距 168px。 */
const ROLE_SLOT_POS = [
  { x: 320, y: 334 }, { x: 909, y: 334 },
  { x: 320, y: 502 }, { x: 909, y: 502 },
  { x: 320, y: 670 }, { x: 909, y: 670 },
];
const PAGE_SIZE = ROLE_SLOT_POS.length;

/** 翻页滑动：一次推进 3 行 = 504px。singleShot 避免惯性滚动导致位移不可控。 */
const SWIPE_X = 800;
const PAGE_UP_FROM_Y = 700;
const PAGE_UP_TO_Y = PAGE_UP_FROM_Y - 504;
const SWIPE_DURATION_MS = 800;
/** 归顶：连续下滑若干次，保证起点归一化到列表顶部。 */
const SCROLL_TOP_TIMES = 3;

/** 确认登录按钮轮询：约 3s 窗口内多次检测，避免慢机渲染延迟被误判成"已在目标角色"。 */
export const SURELOGIN_POLL_TIMES = 6;
const SURELOGIN_POLL_INTERVAL_SEC = 0.5;

const SURELOGIN_SEARCH_REGION = { x: 864, y: 598, width: 1168 - 864, height: 680 - 598 };
const ICON_ROLE_TEMPLATE = path.join(getTemplatesDir(), 'icon_role.png');
const ICON_ROLE_THRESHOLD = 0.75;
const BTN_SURELOGIN_TEMPLATE = path.join(getTemplatesDir(), 'btn_surelogin.png');
const SURELOGIN_THRESHOLD = 0.7;

/** 确认登录按钮轮询：约 3s 内多次检测。返回首次命中的检测结果，全程未命中返回 null。 */
async function waitForSureLogin(ctx: PluginContext) {
  let attempt = 0;
  for (; attempt < SURELOGIN_POLL_TIMES; attempt++) {
    ctx.log(`  [确认登录轮询] 第 ${attempt + 1}/${SURELOGIN_POLL_TIMES} 次`);
    const r = await ctx.findImageWithLocation(
      BTN_SURELOGIN_TEMPLATE, SURELOGIN_THRESHOLD, undefined, undefined, undefined, SURELOGIN_SEARCH_REGION,
    );
    if (r.found) return r;
    if (attempt < SURELOGIN_POLL_TIMES - 1) await ctx.sleep(SURELOGIN_POLL_INTERVAL_SEC);
  }
  return null;
}

/**
 * 位置式角色切换：头像 → 设置 → 角色管理 → 归顶 → 按需翻页 → 点目标星标位 → 确认登录 → 等进城。
 *
 * 零 OCR：角色名可自定义（含繁体、符号）不可靠，服务器号同服可重复；
 * 星标区按添加顺序排列且不重排，因此星标序号是稳定索引。
 *
 * @param starredIndex 星标列表中的序号，从 1 开始。
 */
export async function switchRole(ctx: PluginContext, starredIndex: number): Promise<SwitchRoleResult> {
  ctx.log(`=== 切换角色 starredIndex=${starredIndex} ===`);

  if (!Number.isInteger(starredIndex) || starredIndex < 1) {
    ctx.log(`  ❌ 星标序号非法: ${starredIndex}`);
    return 'invalid_index';
  }

  ctx.log(`  [1/6] 点头像 (${AVATAR_TAP.x},${AVATAR_TAP.y})`);
  await ctx.tap(AVATAR_TAP.x, AVATAR_TAP.y);
  await ctx.sleep(0.5);

  ctx.log(`  [2/6] 点设置 (${SETTINGS_BTN.x},${SETTINGS_BTN.y})`);
  await ctx.tap(SETTINGS_BTN.x, SETTINGS_BTN.y);
  await ctx.sleep(1);

  const roleIcon = await ctx.findImageWithLocation(ICON_ROLE_TEMPLATE, ICON_ROLE_THRESHOLD);
  ctx.log(`  [3/6] icon_role.png found=${roleIcon.found} conf=${roleIcon.confidence.toFixed(3)}`);
  if (!roleIcon.found) {
    ctx.log(`  ❌ 未找到角色管理入口，关闭设置和玩家页后结束`);
    await ctx.tap(CLOSE_SETTINGS_BTN.x, CLOSE_SETTINGS_BTN.y);
    await ctx.sleep(0.3);
    await ctx.tap(CLOSE_PLAYER_BTN.x, CLOSE_PLAYER_BTN.y);
    return 'not_found';
  }
  await ctx.tap(roleIcon.x, roleIcon.y);
  await ctx.sleep(1);

  // 归顶：起点归一化，否则翻页数无意义
  ctx.log(`  [4/6] 归顶（下滑 ${SCROLL_TOP_TIMES} 次）`);
  for (let i = 0; i < SCROLL_TOP_TIMES; i++) {
    await ctx.swipe(SWIPE_X, PAGE_UP_TO_Y, SWIPE_X, PAGE_UP_FROM_Y, SWIPE_DURATION_MS, false, true);
    await ctx.sleep(0.4);
  }

  const pageIdx = Math.floor((starredIndex - 1) / PAGE_SIZE);
  const slotIdx = (starredIndex - 1) % PAGE_SIZE;
  if (pageIdx > 0) {
    ctx.log(`  [5a/6] 向下翻 ${pageIdx} 页`);
    for (let i = 0; i < pageIdx; i++) {
      await ctx.swipe(SWIPE_X, PAGE_UP_FROM_Y, SWIPE_X, PAGE_UP_TO_Y, SWIPE_DURATION_MS, false, true);
      await ctx.sleep(0.5);
    }
  }

  const target = ROLE_SLOT_POS[slotIdx];
  ctx.log(`  [5/6] 点第 ${slotIdx + 1} 号位 (${target.x},${target.y})`);
  await ctx.tap(target.x, target.y);
  await ctx.sleep(0.5);

  const sureLogin = await waitForSureLogin(ctx);
  ctx.log(`  [6/6] btn_surelogin.png ${sureLogin ? '找到确认登录' : `约 ${SURELOGIN_POLL_TIMES} 次轮询后仍未出现确认登录，判定已在目标角色`}`);
  if (!sureLogin) {
    // 点击当前已激活的角色不会重新登录，界面原地不动 —— 判定已在目标角色，
    // 逐层关掉打开的 3 个界面回城，报 already_active（调用方视作成功）。
    ctx.log(`  ℹ️ 未出现确认登录，判定已在目标角色，关闭角色管理/设置/玩家页`);
    await ctx.tap(CLOSE_ROLE_BTN.x, CLOSE_ROLE_BTN.y);
    await ctx.sleep(0.3);
    await ctx.tap(CLOSE_SETTINGS_BTN.x, CLOSE_SETTINGS_BTN.y);
    await ctx.sleep(0.3);
    await ctx.tap(CLOSE_PLAYER_BTN.x, CLOSE_PLAYER_BTN.y);
    return 'already_active';
  }

  ctx.log(`  [6/6] 点确认登录 (${sureLogin.x},${sureLogin.y})`);
  await ctx.tap(sureLogin.x, sureLogin.y);
  return await waitForCityAfterLogin(ctx);
}