import { PluginContext } from '../../../core/plugin';
import { getTemplatesDir } from '../../../core/resourcePath';
import * as path from 'path';

const ATTACK_ICON_TEMPLATE = path.join(getTemplatesDir(), 'Icon_Attack.png');

// 攻击图标搜索区域：屏幕右下角 (1253,651)-(1589,781)
const ATTACK_REGION = { x: 1253, y: 651, width: 1589 - 1253, height: 781 - 651 };

/**
 * 攻击检测：在右下角区域搜索 Icon_Attack.png。
 * 只读屏 + 匹配，不点击任何按钮，不占用 deviceBusy 锁。
 *
 * 输出日志：`[CHECK-ATTACK] attacked=true/false`（供前端 grep 判断）。
 */
export async function checkAttack(ctx: PluginContext): Promise<boolean> {
  const result = await ctx.findImageWithLocation(
    ATTACK_ICON_TEMPLATE,
    0.75,
    undefined,
    false,
    undefined,
    ATTACK_REGION
  );
  ctx.log(`[CHECK-ATTACK] attacked=${result.found} confidence=${result.confidence.toFixed(3)}`);
  return result.found;
}
