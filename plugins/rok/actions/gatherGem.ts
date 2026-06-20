import { PluginContext } from '../../../core/plugin';
import { RokConfig } from '../index';
import { getTemplatesDir } from '../../../core/resourcePath';
import { ensureInWorld } from '../utils/location';
import { Vision } from '../../../core/vision';
import * as path from 'path';
import * as fs from 'fs/promises';
import sharp from 'sharp';
import { ocrService } from '../../../core/ocr/OcrService';
import { ensureTeamPage, TeamPage } from '../utils/teamPage';

const vision = new Vision();

function isDevEnv(): boolean {
  try {
    const { app } = require('electron');
    return !app.isPackaged;
  } catch {
    return true; // 非 Electron 环境（纯 Node.js），视为 dev
  }
}

const TEMPLATE_DIR = getTemplatesDir();
const ADD_TEAM_BTN_TEMPLATE = path.join(TEMPLATE_DIR, 'AddTeamBtn.png');
const PAGE_INDICATOR_TEMPLATE = path.join(TEMPLATE_DIR, 'btn_page_indicator.png');
const CAIJI_STATE_TEMPLATE = path.join(TEMPLATE_DIR, 'CaiJiState_result.png');
const PICKAXE_TEMPLATES = [
  path.join(TEMPLATE_DIR, '红色锄头.png'),
  path.join(TEMPLATE_DIR, '蓝色锄头.png'),
  path.join(TEMPLATE_DIR, '黄色锄头.png'),
];

// 队伍选择坐标（复用 gatherResources）
const SELECT_TEAM_BUTTON = { x: 1259, y: 180 };
const TEAM_BUTTONS_NO_PAGE: Record<number, { x: number; y: number }> = {
  1: { x: 1378, y: 292 },
  2: { x: 1378, y: 359 },
  3: { x: 1378, y: 430 },
  4: { x: 1378, y: 499 },
  5: { x: 1378, y: 565 },
};
const TEAM_BUTTONS_PAGED: Record<number, { x: number; y: number }> = {
  1: { x: 1378, y: 328 },
  2: { x: 1378, y: 392 },
  3: { x: 1378, y: 465 },
  4: { x: 1378, y: 529 },
  5: { x: 1378, y: 595 },
};
const MARCH_BUTTON = { x: 1154, y: 791 };
const CLOSE_POPUP_BUTTON = { x: 1392, y: 57 };

// 中心坐标显示区域 (400,11)-(537,43)，格式 X:1023 Y:290
const COORD_REGION = { x: 400, y: 11, w: 137, h: 32 };
const COORD_TOLERANCE = 5;

/** 从 OCR 文本解析坐标，如 "X:1023 Y:290"，兼容 OCR 将 Y 误识别为 ¥ */
function parseCoord(text: string): { x: number; y: number } | null {
  const sanitized = text.replace(/¥/g, 'Y');
  const match = sanitized.match(/X:\s*(\d+)\s*Y:\s*(\d+)/i);
  if (!match) return null;
  return { x: parseInt(match[1], 10), y: parseInt(match[2], 10) };
}

/** 检查坐标是否与已采集记录重合（容差 ±COORD_TOLERANCE） */
function isCoordRecorded(
  x: number, y: number,
  recorded: Array<{ x: number; y: number }>
): boolean {
  return recorded.some(r =>
    Math.abs(r.x - x) <= COORD_TOLERANCE && Math.abs(r.y - y) <= COORD_TOLERANCE
  );
}

const SPIRAL_DIRECTIONS = [
  { dx: 0, dy: -1 },  // 上
  { dx: 1, dy: 0 },   // 右
  { dx: 0, dy: 1 },   // 下
  { dx: -1, dy: 0 },  // 左
];
const SPIRAL_DIR_NAMES = ['↑', '→', '↓', '←'];

function isInChatZone(x: number, y: number): boolean {
  return x >= 0 && x <= 814 && y >= 794 && y <= 900;
}

/** 检测宝石上方 60x60 区域是否有锄头图标（有人正在采集） */
async function isGemOccupied(
  ctx: PluginContext,
  gemX: number,
  gemY: number
): Promise<boolean> {
  // 裁剪到屏幕范围内（1600×900）
  let rx = Math.max(0, Math.min(1600 - 60, gemX - 30));
  let ry = Math.max(0, Math.min(900 - 60, gemY - 60));
  const regionPath = await ctx.captureRegion(Math.round(rx), Math.round(ry), 60, 60);
  try {
    for (const template of PICKAXE_TEMPLATES) {
      const result = await vision.findImage(regionPath, template, 0.65);
      if (result.found) {
        ctx.log(`  检测到锄头图标 (confidence: ${result.confidence.toFixed(3)})，宝石已被占用`);
        return true;
      }
    }
    return false;
  } finally {
    await fs.unlink(regionPath).catch(() => {});
  }
}

export interface SpiralState {
  step: number;
  dirIndex: number;
  moveCount: number;
  dirSwipes: number;
  checkedCenter: boolean;
  halfW: number;
  halfH: number;
  maxAttempts: number;
}

export function createSpiralState(config: RokConfig): SpiralState {
  const gg = config.gemGather;
  return {
    step: 1,
    dirIndex: 0,
    moveCount: 0,
    dirSwipes: 0,
    checkedCenter: false,
    halfW: Math.round(1600 * (gg.spiralSwipeRatioH ?? gg.spiralSwipeRatio) / 2),
    halfH: Math.round(900 * gg.spiralSwipeRatio / 2),
    maxAttempts: gg.searchMaxAttempts,
  };
}

export async function zoomOutToWorld(
  ctx: PluginContext,
  worldBtn: { x: number; y: number }
): Promise<void> {
  ctx.log(`  长按城内外按钮 (${worldBtn.x}, ${worldBtn.y}) 2秒`);
  await ctx.swipeAndHold(worldBtn.x, worldBtn.y, worldBtn.x, worldBtn.y, 2000);
  await ctx.releaseHold();
  await ctx.sleep(0.5);
  ctx.log(`  点击 (322, 700) 完成缩放`);
  await ctx.tap(322, 700);
  await ctx.sleep(0.5);
}

export async function checkIdleTeamsAvailable(ctx: PluginContext): Promise<boolean> {
  const { width: addTeamW = 80, height: addTeamH = 80 } = await sharp(ADD_TEAM_BTN_TEMPLATE).metadata();
  const x = 1517 - Math.floor(addTeamW! / 2);
  const y = 130 - Math.floor(addTeamH! / 2);
  const regionPath = await ctx.captureRegion(x, y, addTeamW!, addTeamH!);
  try {
    const diff = await ctx.compareImages(regionPath, ADD_TEAM_BTN_TEMPLATE);
    ctx.log(`  AddTeamBtn 匹对差异: ${(diff * 100).toFixed(1)}%`);
    return diff < 0.3;
  } finally {
    await fs.unlink(regionPath).catch(() => {});
  }
}

/**
 * 螺旋搜矿 → 点击宝石 → 占用/重复检测 → 找采集按钮（点中）。
 * 内部循环：找到一颗满足条件的宝石（未占用、未重复采集、采集按钮可点）才返回 found:true。
 * 否则螺旋耗尽返回 found:false。
 *
 * 原地修改 spiralState（沿用螺旋进度）。collectedCoords 仅做读侧检查，写入由调用者负责。
 */
export async function searchAndClickGem(
  ctx: PluginContext,
  config: RokConfig,
  spiralState: SpiralState,
  collectedCoords: Array<{ x: number; y: number }>
): Promise<{ found: true; x: number; y: number } | { found: false }> {
  const gg = config.gemGather;
  const caijiBtnTemplate = path.join(TEMPLATE_DIR, gg.caijiBtnTemplate);
  const worldBtn = config.resourceCollect.worldSwitchButton;

  while (true) {
    let gemFound = false;
    let gemX = 0, gemY = 0;

    if (!spiralState.checkedCenter) {
      spiralState.checkedCenter = true;
      const initDets = await ctx.detectWithScreenshot(0.5);
      ctx.log(`  [搜索] 中心(5) 找到 ${initDets.length} 个宝石候选`);
      const initValid = initDets.find(d => !isInChatZone(d.x, d.y));
      if (initValid) {
        if (await isGemOccupied(ctx, initValid.x, initValid.y)) {
          ctx.log(`  宝石 (${initValid.x}, ${initValid.y}) 已被占用，继续搜索`);
        } else {
          gemX = initValid.x; gemY = initValid.y;
          ctx.log(`  找到空闲宝石矿 (${gemX}, ${gemY}) confidence: ${initValid.confidence.toFixed(3)}`);
          gemFound = true;
        }
      }
    }

    while (!gemFound && spiralState.moveCount < spiralState.maxAttempts) {
      const dir = SPIRAL_DIRECTIONS[spiralState.dirIndex % 4];

      while (
        spiralState.dirSwipes < spiralState.step &&
        !gemFound &&
        spiralState.moveCount < spiralState.maxAttempts
      ) {
        const fromX = dir.dx !== 0 ? (800 + dir.dx * spiralState.halfW) : 850;
        const fromY = dir.dy !== 0 ? (450 + dir.dy * spiralState.halfH) : 450;
        const toX   = dir.dx !== 0 ? (800 - dir.dx * spiralState.halfW) : 850;
        const toY   = dir.dy !== 0 ? (450 - dir.dy * spiralState.halfH) : 450;
        spiralState.moveCount++;
        spiralState.dirSwipes++;
        await ctx.swipe(fromX, fromY, toX, toY, 500);
        await ctx.sleep(1 + Math.random() * 0.5);

        const detections = await ctx.detectWithScreenshot(0.5);
        ctx.log(`  [搜索] ${SPIRAL_DIR_NAMES[spiralState.dirIndex % 4]}(${spiralState.moveCount}) 找到 ${detections.length} 个宝石候选`);
        const validDet = detections.find(d => !isInChatZone(d.x, d.y));
        if (validDet) {
          if (await isGemOccupied(ctx, validDet.x, validDet.y)) {
            ctx.log(`  宝石 (${validDet.x}, ${validDet.y}) 已被占用，继续搜索`);
          } else {
            gemX = validDet.x; gemY = validDet.y;
            ctx.log(`  找到空闲宝石矿 (${gemX}, ${gemY}) confidence: ${validDet.confidence.toFixed(3)}`);
            gemFound = true;
            break;
          }
        }
      }

      if (gemFound) break;
      if (spiralState.dirIndex % 2 === 1) spiralState.step++;
      spiralState.dirIndex++;
      spiralState.dirSwipes = 0;
    }

    if (!gemFound) return { found: false };

    // 点击宝石矿
    ctx.log(`  [4/7] 点击宝石矿 (${gemX}, ${gemY})`);
    await ctx.tap(gemX, gemY);
    await ctx.sleep(1.5);

    // 检测采集状态标志（已被占用）
    {
      const caiJiRegionPath = await ctx.captureRegion(745, 360, 157, 142);
      try {
        const caiJiResult = await vision.findImage(caiJiRegionPath, CAIJI_STATE_TEMPLATE, 0.6);
        if (isDevEnv()) {
          try {
            const DEBUG_DIR = 'D:/SLG/temp/debug/caiji';
            await fs.mkdir(DEBUG_DIR, { recursive: true });
            const caiJiMeta = await sharp(caiJiRegionPath).metadata();
            const w = caiJiMeta.width!, h = caiJiMeta.height!;
            const label = caiJiResult.found ? 'OCCUPIED' : 'FREE';
            const color = caiJiResult.found ? '#ff4444' : '#44aa44';
            const svg = `<svg width="${w}" height="${h}" xmlns="http://www.w3.org/2000/svg">
              <rect x="2" y="2" width="${w - 4}" height="${h - 4}" fill="none" stroke="${color}" stroke-width="2" rx="1"/>
              <rect x="2" y="${h - 20}" width="${w - 4}" height="18" fill="${color}" rx="1"/>
              <text x="${w / 2}" y="${h - 6}" font-family="Arial" font-size="10" font-weight="bold" fill="white" text-anchor="middle">${label} ${caiJiResult.confidence.toFixed(2)}</text>
            </svg>`;
            const outPath = path.join(DEBUG_DIR, `caiji_${label}_${Date.now()}.png`);
            await sharp(caiJiRegionPath)
              .composite([{ input: Buffer.from(svg), top: 0, left: 0 }])
              .toFile(outPath);
          } catch {}
        }
        if (caiJiResult.found) {
          ctx.log(`  🔄 该宝石已有队伍在采集 (confidence: ${caiJiResult.confidence.toFixed(3)})，缩地后继续螺旋`);
          await zoomOutToWorld(ctx, worldBtn);
          await ctx.sleep(1);
          continue;
        }
      } finally {
        await fs.unlink(caiJiRegionPath).catch(() => {});
      }
    }

    ctx.log(`  点击放大后的目标 (${gg.pinchedGemTapPoint.x}, ${gg.pinchedGemTapPoint.y})`);
    await ctx.tap(gg.pinchedGemTapPoint.x, gg.pinchedGemTapPoint.y);
    await ctx.sleep(1);

    // 重复坐标检测
    if (collectedCoords.length > 0) {
      const coordRegionPath = await ctx.captureRegion(
        COORD_REGION.x, COORD_REGION.y, COORD_REGION.w, COORD_REGION.h
      );
      try {
        const coordText = await ocrService.readText(coordRegionPath);
        const curCoord = parseCoord(coordText);
        const recorded = collectedCoords.map(c => `(${c.x},${c.y})`).join(', ');
        ctx.log(`  [坐标] 当前: ${coordText} → ${curCoord ? `(${curCoord.x},${curCoord.y})` : '解析失败'} | 已采集: [${recorded}]`);
        if (curCoord && isCoordRecorded(curCoord.x, curCoord.y, collectedCoords)) {
          ctx.log(`  ⚠️ 该宝石已采集过，缩地后继续螺旋`);
          await zoomOutToWorld(ctx, worldBtn);
          await ctx.sleep(1);
          continue;
        }
      } finally {
        await fs.unlink(coordRegionPath).catch(() => {});
      }
    }

    // 识别采集按钮
    ctx.log(`  搜索采集按钮 ${gg.caijiBtnTemplate}`);
    const caijiResult = await ctx.findImageWithLocation(caijiBtnTemplate, 0.7);
    if (caijiResult.found) {
      ctx.log(`  点击采集按钮 (${caijiResult.x}, ${caijiResult.y})`);
      await ctx.tap(caijiResult.x, caijiResult.y);
      await ctx.sleep(1.5);
      return { found: true, x: gemX, y: gemY };
    }
    ctx.log(`  ❌ 未找到采集按钮 (confidence: ${caijiResult.confidence.toFixed(3)})，缩地后继续螺旋`);
    await zoomOutToWorld(ctx, worldBtn);
    await ctx.sleep(1);
  }
}

export interface DispatchResult {
  dispatched: boolean;
  nextTeamIdx: number;
  hasPaging: boolean | null;
  allTeamsBusy: boolean;
}

/**
 * 派出队伍弹窗内逐个尝试队伍：从 nextTeamIdx 开始向后尝试到 teams 末尾（不回绕）。
 * 派出成功后追加当前坐标到 collectedCoords，再 OCR 检测剩余空闲队伍数。
 *
 * - hasPaging=null 时本函数会自检并写回结果（首次调用语义）
 * - allTeamsBusy=true 表示全部已派出（OCR 显示 N/N），调用者应停止采集
 * - dispatched=false 表示弹窗内所有可尝试队伍都不可用（已自动关闭弹窗）
 */
export async function dispatchToTeamPopup(
  ctx: PluginContext,
  config: RokConfig,
  teams: number[],
  nextTeamIdx: number,
  hasPaging: boolean | null,
  collectedCoords: Array<{ x: number; y: number }>,
  teamPage: TeamPage = 'gather'
): Promise<DispatchResult> {
  ctx.log(`  [6/7] 点击选择队伍按钮 (${SELECT_TEAM_BUTTON.x}, ${SELECT_TEAM_BUTTON.y})`);
  await ctx.tap(SELECT_TEAM_BUTTON.x, SELECT_TEAM_BUTTON.y);
  await ctx.sleep(1);

  let pageSwitchButton: { x: number; y: number } | null = null;
  if (hasPaging === null) {
    const pageResult = await ctx.findImageWithLocation(PAGE_INDICATOR_TEMPLATE, 0.8);
    hasPaging = pageResult.found;
    if (hasPaging) {
      pageSwitchButton = { x: pageResult.x, y: pageResult.y };
      ctx.log(`  [检测] 换页按钮: 存在 (>7组) @ (${pageResult.x},${pageResult.y})`);
    } else {
      ctx.log(`  [检测] 换页按钮: 不存在 (≤7组)`);
    }
  } else if (hasPaging) {
    const pageResult = await ctx.findImageWithLocation(PAGE_INDICATOR_TEMPLATE, 0.8);
    if (pageResult.found) {
      pageSwitchButton = { x: pageResult.x, y: pageResult.y };
    }
  }

  if (hasPaging && pageSwitchButton) {
    const onTargetPage = await ensureTeamPage(ctx, teamPage, pageSwitchButton);
    if (!onTargetPage) {
      ctx.log(`  ⚠️ 未能切换到目标队伍页，关闭弹窗`);
      await ctx.tap(CLOSE_POPUP_BUTTON.x, CLOSE_POPUP_BUTTON.y);
      await ctx.sleep(0.5);
      return { dispatched: false, nextTeamIdx, hasPaging, allTeamsBusy: false };
    }
  }

  const teamButtons = (hasPaging ?? false) ? TEAM_BUTTONS_PAGED : TEAM_BUTTONS_NO_PAGE;

  if (nextTeamIdx >= teams.length) {
    ctx.log(`  所有配置队伍已派出（${teams.length}队），关闭弹窗`);
    await ctx.tap(CLOSE_POPUP_BUTTON.x, CLOSE_POPUP_BUTTON.y);
    await ctx.sleep(0.5);
    return { dispatched: false, nextTeamIdx, hasPaging, allTeamsBusy: false };
  }

  let dispatched = false;
  let allTeamsBusy = false;
  let newNextTeamIdx = nextTeamIdx;

  for (let ti = nextTeamIdx; ti < teams.length; ti++) {
    const tryTeam = teams[ti];
    const teamBtn = teamButtons[tryTeam];
    if (!teamBtn) {
      ctx.log(`  ❌ 无效的队伍序号: ${tryTeam}`);
      continue;
    }

    ctx.log(`  [7/7] 尝试队伍 ${tryTeam} (配置第${ti + 1}队) 并检测状态变化...`);
    const stateResult = await ctx.checkButtonStateChange(teamBtn.x, teamBtn.y, 150, 50, 0.1);
    ctx.log(`  [debug] 像素变化率: ${(stateResult.diffPercentage * 100).toFixed(1)}%, changed: ${stateResult.changed}`);

    if (!stateResult.changed) {
      ctx.log(`  ⚠️ 队伍${tryTeam}不可用，尝试下一队`);
      continue;
    }

    await ctx.sleep(0.3 + Math.random() * 0.4);
    ctx.log(`  点击行军按钮 (${MARCH_BUTTON.x}, ${MARCH_BUTTON.y})`);
    await ctx.tap(MARCH_BUTTON.x, MARCH_BUTTON.y);
    await ctx.sleep(0.8 + Math.random() * 0.7);

    newNextTeamIdx = (ti === teams.length - 1) ? 0 : ti + 1;
    ctx.log(`  ✅ 队伍${tryTeam} 已派出（下次从第${newNextTeamIdx + 1}队开始）`);

    {
      const coordRegionPath = await ctx.captureRegion(
        COORD_REGION.x, COORD_REGION.y, COORD_REGION.w, COORD_REGION.h
      );
      try {
        const coordText = await ocrService.readText(coordRegionPath);
        ctx.log(`  [坐标] 记录已采集: ${coordText}`);
        const curCoord = parseCoord(coordText);
        if (curCoord) {
          collectedCoords.push(curCoord);
        } else {
          ctx.log(`  [坐标] 解析失败，跳过记录`);
        }
      } finally {
        await fs.unlink(coordRegionPath).catch(() => {});
      }
    }

    ctx.log(`  [OCR] 检测剩余空闲队伍数...`);
    const teamRegionPath = await ctx.captureRegion(1507, 169, 55, 31);
    try {
      const teamText = await ocrService.readText(teamRegionPath);
      ctx.log(`  [OCR] 结果: "${teamText}"`);
      const tm = teamText.match(/(\d+)\s*\/\s*(\d+)/);
      if (tm) {
        const used = parseInt(tm[1], 10);
        const total = parseInt(tm[2], 10);
        if (used === total) {
          ctx.log(`  ⏭️ 队伍已全部派出 (${used}/${total})`);
          allTeamsBusy = true;
        } else {
          ctx.log(`  剩余空闲队伍: ${total - used} (${used}/${total})`);
        }
      }
    } finally {
      await fs.unlink(teamRegionPath).catch(() => {});
    }

    dispatched = true;
    break;
  }

  if (!dispatched) {
    ctx.log(`  所有队伍不可用，关闭弹窗`);
    await ctx.tap(CLOSE_POPUP_BUTTON.x, CLOSE_POPUP_BUTTON.y);
    await ctx.sleep(0.5);
  }

  return { dispatched, nextTeamIdx: newNextTeamIdx, hasPaging, allTeamsBusy };
}

export interface GemGatherOutcome {
  result: 'success' | 'not_found' | 'no_idle_teams' | 'team_unavailable';
  dispatched: number;
}

export async function gatherGem(
  ctx: PluginContext,
  config: RokConfig,
  teams: number[],
  options?: { collectedCoords?: Array<{ x: number; y: number }>; teamPage?: TeamPage }
): Promise<GemGatherOutcome> {
  ctx.log(`=== 智能采集宝石 队伍[${teams.join(', ')}] ===`);

  const gg = config.gemGather;
  const caijiBtnTemplate = path.join(TEMPLATE_DIR, gg.caijiBtnTemplate);
  const worldBtn = config.resourceCollect.worldSwitchButton;

  let dispatched = 0;
  let hasPaging: boolean | null = null;
  let nextTeamIdx = 0;  // 下次从 teams[nextTeamIdx] 开始尝试
  const collectedCoords = options?.collectedCoords ?? [];
  const teamPage = options?.teamPage ?? 'gather';

  // [1/7] 重置城外默认视角（所有队伍共一次）
  ctx.log('[1/7] 重置城外默认视角');
  await ensureInWorld(ctx, config);

  // [2/7] 缩小地图（所有队伍共一次，后续在每队结束后缩地接续）
  ctx.log('[2/7] 缩小地图');
  // 双指缩放 → 改为：长按城内外按钮2秒 + 点击(322,700)
  // const p = gg.pinch;
  // // 缩放角度抖动：保持中心 (800,450) 和缩放比例不变，仅旋转捏合轴线
  // const pinchAngleJitter = 15 * Math.PI / 180; // ±15°
  // const doPinch = () => {
  //   const angle = (Math.random() * 2 - 1) * pinchAngleJitter;
  //   const cos = Math.cos(angle), sin = Math.sin(angle);
  //   const cx = 800, cy = 450;
  //   const startR = 500, endR = 250;
  //   // 手指1: 中心左侧, 手指2: 中心右侧，绕中心旋转 angle
  //   const f1sx = cx - startR * cos, f1sy = cy - startR * sin;
  //   const f1ex = cx - endR * cos,   f1ey = cy - endR * sin;
  //   const f2sx = cx + startR * cos, f2sy = cy + startR * sin;
  //   const f2ex = cx + endR * cos,   f2ey = cy + endR * sin;
  //   return ctx.pinch(
  //     Math.round(f1sx), Math.round(f1sy),
  //     Math.round(f2sx), Math.round(f2sy),
  //     Math.round(f1ex), Math.round(f1ey),
  //     Math.round(f2ex), Math.round(f2ey),
  //     p.duration
  //   );
  // };
  await zoomOutToWorld(ctx, worldBtn);
  await ctx.sleep(1);

  // 螺旋搜索状态（全程接续，不因换队重置）
  const spiralState = createSpiralState(config);

  ctx.log(`[3/7] 方形螺旋搜索宝石矿（YOLO 检测, 上限 ${gg.searchMaxAttempts} 步）`);

  let gemCount = 0;
  while (true) {
    gemCount++;
    ctx.log(`--- 搜索第 ${gemCount} 颗宝石矿 ---`);

    const gem = await searchAndClickGem(ctx, config, spiralState, collectedCoords);
    if (!gem.found) {
      ctx.log(`  ❌ 搜索耗尽(${spiralState.moveCount}步)，未找到空闲宝石矿，任务完成`);
      await ctx.tap(worldBtn.x, worldBtn.y);
      await ctx.sleep(0.8 + Math.random() * 0.7);
      await ctx.tap(worldBtn.x, worldBtn.y);
      await ctx.sleep(1.5 + Math.random() * 1.0);
      break;
    }

    // [5/7] 检测空闲队伍
    ctx.log(`  [5/7] 检测是否有空闲队伍...`);
    const idleAvailable = await checkIdleTeamsAvailable(ctx);
    if (!idleAvailable) {
      ctx.log(`  ⚠️ 没有空闲队伍，停止采集，切换回城内`);
      await ctx.tap(worldBtn.x, worldBtn.y);
      await ctx.sleep(1.5 + Math.random() * 1.0);
      break;
    }
    ctx.log(`  有空闲队伍，继续`);

    const r = await dispatchToTeamPopup(ctx, config, teams, nextTeamIdx, hasPaging, collectedCoords, teamPage);
    hasPaging = r.hasPaging;
    nextTeamIdx = r.nextTeamIdx;
    if (r.dispatched) dispatched++;

    if (!r.dispatched) {
      ctx.log(`  无可用队伍，任务完成`);
      break;
    }
    if (r.allTeamsBusy) {
      ctx.log(`  队伍已全部派出，任务完成`);
      break;
    }

    // 缩地后接续螺旋搜索下一颗矿
    await zoomOutToWorld(ctx, worldBtn);
    await ctx.sleep(1);
  }

  ctx.log(`=== 宝石采集完成：派出 ${dispatched} 队 ===`);
  return { result: dispatched > 0 ? 'success' : 'not_found', dispatched };
}
