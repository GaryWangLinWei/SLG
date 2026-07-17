import { PluginContext } from '../../../core/plugin';
import { RokConfig } from '../index';
import { sharedGemPool } from '../state/sharedGemPool';
import { locateByCoord } from '../utils/locateCoord';
import { ensureInWorld } from '../utils/location';
import { collectSharedGemCoords } from './collectSharedGemCoords';
import {
  dispatchToTeamPopup,
  verifyGemAtCenter,
} from './gatherGem';
import { TeamPage } from '../utils/teamPage';

const PINCHED_GEM_TARGET_RECT = { x1: 792, y1: 426, x2: 878, y2: 502 };
const REFILL_THRESHOLD = 5;

export interface GatherSharedGemOutcome {
  result: 'ok' | 'empty' | 'no_team';
  gathered: number;
}

export interface GatherSharedGemParams {
  accountId: string;
  teams: number[];
  teamPage?: TeamPage;
}

/**
 * 从 sharedGemPool 中出队坐标进行采集：
 *   - pool.size < REFILL_THRESHOLD 时先触发一次 collectSharedGemCoords 扩充
 *   - pool 空则返回 'empty'，主循环走「切号」逻辑
 *   - 每个坐标出队即消耗（策略 A）
 */
export async function gatherSharedGem(
  ctx: PluginContext,
  config: RokConfig,
  params: GatherSharedGemParams
): Promise<GatherSharedGemOutcome> {
  const { accountId, teams } = params;
  const teamPage: TeamPage = params.teamPage ?? 'gather';
  ctx.log(`=== 采集分享矿 account=${accountId} teams=[${teams.join(',')}] ===`);

  ctx.log(`[1] 切换到城外`);
  await ensureInWorld(ctx, config);

  if (sharedGemPool.size(accountId) < REFILL_THRESHOLD) {
    ctx.log(`[2] 池数量 ${sharedGemPool.size(accountId)} < ${REFILL_THRESHOLD}，先收集`);
    await collectSharedGemCoords(ctx, accountId);
    await ensureInWorld(ctx, config);
  }

  if (sharedGemPool.size(accountId) === 0) {
    ctx.log(`[2] 池为空，本轮结束`);
    return { result: 'empty', gathered: 0 };
  }

  const collectedCoords: string[] = [];
  let nextTeamIdx = 0;
  let hasPaging: boolean | null = null;
  let gathered = 0;

  while (sharedGemPool.size(accountId) > 0) {
    const coord = sharedGemPool.pop(accountId)!;
    ctx.log(`[3] 定位坐标 (${coord.x},${coord.y})，剩余池 ${sharedGemPool.size(accountId)}`);
    await locateByCoord(ctx, coord.x, coord.y);
    await ctx.sleep(2);

    const verified = await verifyGemAtCenter(ctx);
    if (!verified) {
      ctx.log(`  ⚠️ (${coord.x},${coord.y}) 中心未确认宝石，跳过`);
      continue;
    }

    ctx.log(`  点击宝石 rect=${JSON.stringify(PINCHED_GEM_TARGET_RECT)}`);
    await ctx.tapRect(PINCHED_GEM_TARGET_RECT.x1, PINCHED_GEM_TARGET_RECT.y1, PINCHED_GEM_TARGET_RECT.x2, PINCHED_GEM_TARGET_RECT.y2);
    await ctx.sleep(1);

    const r = await dispatchToTeamPopup(ctx, config, teams, nextTeamIdx, hasPaging, collectedCoords, teamPage);
    hasPaging = r.hasPaging;
    nextTeamIdx = r.nextTeamIdx;

    if (r.dispatched) {
      gathered++;
      ctx.log(`  ✅ 派兵成功，累计 ${gathered}`);
    } else {
      ctx.log(`  ⚠️ 派兵失败，跳过`);
    }

    if (r.allTeamsBusy) {
      ctx.log(`[4] 队伍全忙，停止本轮`);
      return { result: 'no_team', gathered };
    }
  }

  ctx.log(`=== 采集完成 gathered=${gathered} ===`);
  return { result: 'ok', gathered };
}
