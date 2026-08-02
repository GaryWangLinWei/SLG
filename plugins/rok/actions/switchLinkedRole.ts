import * as path from 'path';
import { PluginContext } from '../../../core/plugin';
import { getTemplatesDir } from '../../../core/resourcePath';
import { waitForCityAfterLogin } from './switchAccount';
import { LinkedDirection } from './switchAccountKind';

export type SwitchLinkedRoleResult = 'success' | 'not_found' | 'switched_load_timeout';

const AVATAR_TAP = { x: 63, y: 51 };
const SETTINGS_BTN = { x: 1358, y: 743 };
const MAIN_CHAR_BTN = { x: 320, y: 334 };    // 主号在左
const LINKED_CHAR_BTN = { x: 909, y: 334 };  // 连体角色在右
const CLOSE_ROLE_BTN = { x: 1366, y: 105 };
const CLOSE_SETTINGS_BTN = { x: 1394, y: 55 };
const CLOSE_PLAYER_BTN = { x: 1454, y: 88 };

const SURELOGIN_SEARCH_REGION = { x: 864, y: 598, width: 1168 - 864, height: 680 - 598 };
const ICON_ROLE_TEMPLATE = path.join(getTemplatesDir(), 'icon_role.png');
const BTN_SURELOGIN_TEMPLATE = path.join(getTemplatesDir(), 'btn_surelogin.png');

/**
 * 连体号切换：头像 → 设置 → 角色管理 → 选目标角色 → 确认登录 → 等进城。
 * @param direction main-to-linked=主号切到连体角色(点右侧)；linked-to-main=连体切回主号(点左侧)。
 */
export async function switchLinkedRole(ctx: PluginContext, direction: LinkedDirection): Promise<SwitchLinkedRoleResult> {
  ctx.log(`=== 切换连体号角色 direction=${direction} ===`);

  ctx.log(`  [1/5] 点头像 (${AVATAR_TAP.x},${AVATAR_TAP.y})`);
  await ctx.tap(AVATAR_TAP.x, AVATAR_TAP.y);
  await ctx.sleep(0.5);

  ctx.log(`  [2/5] 点设置 (${SETTINGS_BTN.x},${SETTINGS_BTN.y})`);
  await ctx.tap(SETTINGS_BTN.x, SETTINGS_BTN.y);
  await ctx.sleep(1);

  const roleIcon = await ctx.findImageWithLocation(ICON_ROLE_TEMPLATE, 0.75);
  ctx.log(`  [3/5] icon_role.png found=${roleIcon.found} conf=${roleIcon.confidence.toFixed(3)}`);
  if (!roleIcon.found) {
    ctx.log(`  ❌ 未找到角色按钮，关闭设置和玩家页后结束`);
    await ctx.tap(CLOSE_SETTINGS_BTN.x, CLOSE_SETTINGS_BTN.y);
    await ctx.sleep(0.3);
    await ctx.tap(CLOSE_PLAYER_BTN.x, CLOSE_PLAYER_BTN.y);
    return 'not_found';
  }
  await ctx.tap(roleIcon.x, roleIcon.y);
  await ctx.sleep(1);

  const target = direction === 'main-to-linked' ? LINKED_CHAR_BTN : MAIN_CHAR_BTN;
  ctx.log(`  [4/5] 点${direction === 'main-to-linked' ? '连体角色(右)' : '主号(左)'} (${target.x},${target.y})`);
  await ctx.tap(target.x, target.y);
  await ctx.sleep(1);

  const sureLogin = await ctx.findImageWithLocation(
    BTN_SURELOGIN_TEMPLATE, 0.7, undefined, undefined, undefined, SURELOGIN_SEARCH_REGION,
  );
  ctx.log(`  [5/5] btn_surelogin.png found=${sureLogin.found} conf=${sureLogin.confidence.toFixed(3)}`);
  if (!sureLogin.found) {
    ctx.log(`  ❌ 未找到连体号确认登录按钮，依次关闭角色管理、设置、玩家页`);
    await ctx.tap(CLOSE_ROLE_BTN.x, CLOSE_ROLE_BTN.y);
    await ctx.sleep(0.3);
    await ctx.tap(CLOSE_SETTINGS_BTN.x, CLOSE_SETTINGS_BTN.y);
    await ctx.sleep(0.3);
    await ctx.tap(CLOSE_PLAYER_BTN.x, CLOSE_PLAYER_BTN.y);
    return 'not_found';
  }
  ctx.log(`  [5/5] 点确认登录 (${sureLogin.x},${sureLogin.y})`);
  await ctx.tap(sureLogin.x, sureLogin.y);

  return await waitForCityAfterLogin(ctx);
}
