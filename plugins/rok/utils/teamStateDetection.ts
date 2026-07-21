import { PluginContext } from '../../../core/plugin';

export type TeamState = 'back' | 'caiji' | 'totarget' | 'zhuzha';

const STATE_CLASS_INDEX: Record<TeamState, number> = {
  back: 0, caiji: 1, totarget: 2, zhuzha: 3,
};
const CLASS_INDEX_STATE: Record<number, TeamState> = {
  0: 'back', 1: 'caiji', 2: 'totarget', 3: 'zhuzha',
};
const STATE_DETECT_THRESHOLD = 0.35;
const STATE_CONF_THRESHOLD = 0.4;
export const STATUS_REGION = { x: 1530, y: 202, w: 52, h: 478 };

export interface DetectedState {
  state: TeamState;
  x: number;
  y: number;
  confidence: number;
}

type Detection = Awaited<ReturnType<PluginContext['detectStateWithScreenshot']>>[number];

function mapDetections(
  ctx: PluginContext,
  detections: Detection[],
  states: TeamState[]
): DetectedState[] {
  const results: DetectedState[] = [];
  for (const detection of detections) {
    const state = CLASS_INDEX_STATE[detection.classIndex];
    if (!state || !states.includes(state) || detection.confidence < STATE_CONF_THRESHOLD) continue;
    const x = Math.round(detection.x);
    const y = Math.round(detection.y);
    results.push({ state, x, y, confidence: detection.confidence });
    ctx.log(`  [${state}] (${x},${y}) conf=${(detection.confidence * 100).toFixed(1)}%`);
  }
  results.sort((a, b) => a.y - b.y);
  return results;
}

/**
 * 全屏 state.onnx 检测。
 *
 * 注意：ONNX 输入固定 640×640，喂窄区域会严重拉伸导致漏检，
 * 因此本函数只做全屏检测；如需限制在某区域，由调用方用坐标过滤。
 */
export async function detectTeamStates(
  ctx: PluginContext,
  states: TeamState[] = ['zhuzha', 'caiji', 'back', 'totarget']
): Promise<DetectedState[]> {
  const classIndices = states.map(state => STATE_CLASS_INDEX[state]);
  ctx.log(`[状态检测] state.onnx 全屏检测 states=[${states.join(',')}]`);
  const detections = await ctx.detectStateWithScreenshot(STATE_DETECT_THRESHOLD, classIndices);
  return mapDetections(ctx, detections, states);
}

export async function detectStatusRegionTeamStates(
  ctx: PluginContext,
  states: TeamState[] = ['zhuzha', 'caiji', 'back', 'totarget']
): Promise<DetectedState[]> {
  const all = await detectTeamStates(ctx, states);
  const r = STATUS_REGION;
  return all.filter(d =>
    d.x >= r.x && d.x <= r.x + r.w && d.y >= r.y && d.y <= r.y + r.h
  );
}
