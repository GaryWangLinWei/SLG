import { PluginContext } from '../../../core/plugin';
import { RokConfig } from '../index';
import { getTemplatesDir } from '../../../core/resourcePath';
import { ensureInWorld } from '../utils/location';
import { Vision } from '../../../core/vision';
import * as path from 'path';
import * as fs from 'fs/promises';
import sharp from 'sharp';
import { ocrService } from '../../../core/ocr/OcrService';

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

export interface GemGatherOutcome {
  result: 'success' | 'not_found' | 'no_idle_teams' | 'team_unavailable';
  dispatched: number;
}

export async function gatherGem(
  ctx: PluginContext,
  config: RokConfig,
  teams: number[]
): Promise<GemGatherOutcome> {
  ctx.log(`=== 智能采集宝石 队伍[${teams.join(', ')}] ===`);

  const gg = config.gemGather;
  const caijiBtnTemplate = path.join(TEMPLATE_DIR, gg.caijiBtnTemplate);
  const worldBtn = config.resourceCollect.worldSwitchButton;

  let dispatched = 0;
  let hasPaging: boolean | null = null;
  let nextTeamIdx = 0;  // 下次从 teams[nextTeamIdx] 开始尝试
  const collectedCoords: Array<{ x: number; y: number }> = [];

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
  const doZoomOut = async () => {
    ctx.log(`  长按城内外按钮 (${worldBtn.x}, ${worldBtn.y}) 2秒`);
    await ctx.swipeAndHold(worldBtn.x, worldBtn.y, worldBtn.x, worldBtn.y, 2000);
    await ctx.releaseHold();
    await ctx.sleep(0.5);
    ctx.log(`  点击 (322, 700) 完成缩放`);
    await ctx.tap(322, 700);
    await ctx.sleep(0.5);
  };
  await doZoomOut();
  await ctx.sleep(1);

  // 螺旋搜索状态（全程接续，不因换队重置）
  const halfW = Math.round(1600 * (gg.spiralSwipeRatioH ?? gg.spiralSwipeRatio) / 2);
  const halfH = Math.round(900 * gg.spiralSwipeRatio / 2);
  let step = 1;
  let dirIndex = 0;
  let moveCount = 0;
  let dirSwipes = 0;  // 当前方向已滑动次数，接续重试时不重置
  let checkedCenter = false;

  ctx.log(`[3/7] 方形螺旋搜索宝石矿（YOLO 检测, 上限 ${gg.searchMaxAttempts} 步）`);

  let gemCount = 0;
  while (true) {
    gemCount++;
    ctx.log(`--- 搜索第 ${gemCount} 颗宝石矿 ---`);

    // [4/7] 搜索 → 点击采集（找不到采集按钮时缩地重搜，直到耗尽螺旋搜索范围）
    let caijiFound = false;
    let gemFound = false;
    let gemX = 0;
    let gemY = 0;

    while (!caijiFound) {
      gemFound = false;

      // 仅在首次搜索时检测中心，之后从螺旋位置继续
      if (!checkedCenter) {
        checkedCenter = true;
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

      while (!gemFound && moveCount < gg.searchMaxAttempts) {
        const dir = SPIRAL_DIRECTIONS[dirIndex % 4];

        while (dirSwipes < step && !gemFound && moveCount < gg.searchMaxAttempts) {
          const fromX = dir.dx !== 0 ? (800 + dir.dx * halfW) : 850;
          const fromY = dir.dy !== 0 ? (450 + dir.dy * halfH) : 450;
          const toX   = dir.dx !== 0 ? (800 - dir.dx * halfW) : 850;
          const toY   = dir.dy !== 0 ? (450 - dir.dy * halfH) : 450;
          moveCount++;
          dirSwipes++;
          await ctx.swipe(fromX, fromY, toX, toY, 500);
          await ctx.sleep(1 + Math.random() * 0.5);  // 1-1.5s 随机间隔

          const detections = await ctx.detectWithScreenshot(0.5);
          ctx.log(`  [搜索] ${SPIRAL_DIR_NAMES[dirIndex % 4]}(${moveCount}) 找到 ${detections.length} 个宝石候选`);
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
        if (dirIndex % 2 === 1) step++;
        dirIndex++;
        dirSwipes = 0;
      }

      if (!gemFound) break;  // 搜索不到宝石矿，退出重试循环

      // [4/7] 点击宝石矿
      ctx.log(`  [4/7] 点击宝石矿 (${gemX}, ${gemY})`);
      await ctx.tap(gemX, gemY);
      await ctx.sleep(1.5);

      // 检测 (745,360)-(902,502) 区域是否有采集状态标志，有说明已在采集，缩回继续找
      {
        const caiJiRegionPath = await ctx.captureRegion(745, 360, 157, 142);
        try {
          const caiJiResult = await vision.findImage(caiJiRegionPath, CAIJI_STATE_TEMPLATE, 0.6);
          // 调试：保存采集状态检测截图（红框+置信度）
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
            await fs.unlink(caiJiRegionPath).catch(() => {});
            await doZoomOut();
            await ctx.sleep(1);
            continue;  // 回到 caijiRetry 循环，继续螺旋搜索
          }
        } finally {
          await fs.unlink(caiJiRegionPath).catch(() => {});
        }
      }

      ctx.log(`  点击放大后的目标 (${gg.pinchedGemTapPoint.x}, ${gg.pinchedGemTapPoint.y})`);
      await ctx.tap(gg.pinchedGemTapPoint.x, gg.pinchedGemTapPoint.y);
      await ctx.sleep(1);

      // 检测当前中心坐标，与已采集记录比对，避免重复采集
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
            await doZoomOut();
            await ctx.sleep(1);
            continue;  // 回到 caijiRetry 循环，继续螺旋搜索
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
        caijiFound = true;
      } else {
        ctx.log(`  ❌ 未找到采集按钮 (confidence: ${caijiResult.confidence.toFixed(3)})，缩地后继续螺旋`);
        await doZoomOut();
        await ctx.sleep(1);
      }
    }

    if (!gemFound) {
      ctx.log(`  ❌ 搜索耗尽(${moveCount}步)，未找到空闲宝石矿，任务完成`);
      await ctx.tap(worldBtn.x, worldBtn.y);
      await ctx.sleep(0.8 + Math.random() * 0.7);   // 0.8-1.5s
      await ctx.tap(worldBtn.x, worldBtn.y);
      await ctx.sleep(1.5 + Math.random() * 1.0);   // 1.5-2.5s
      break;
    }

    // [5/7] 检测空闲队伍
    ctx.log(`  [5/7] 检测是否有空闲队伍...`);
    const { width: addTeamW = 80, height: addTeamH = 80 } = await sharp(ADD_TEAM_BTN_TEMPLATE).metadata();
    const addTeamRegionX = 1517 - Math.floor(addTeamW! / 2);
    const addTeamRegionY = 130 - Math.floor(addTeamH! / 2);
    const addTeamRegionPath = await ctx.captureRegion(addTeamRegionX, addTeamRegionY, addTeamW!, addTeamH!);
    const addTeamDiff = await ctx.compareImages(addTeamRegionPath, ADD_TEAM_BTN_TEMPLATE);
    ctx.log(`  AddTeamBtn 匹对差异: ${(addTeamDiff * 100).toFixed(1)}%`);

    if (addTeamDiff >= 0.3) {
      ctx.log(`  ⚠️ 没有空闲队伍，停止采集，切换回城内`);
      await fs.unlink(addTeamRegionPath).catch(() => {});
      await ctx.tap(worldBtn.x, worldBtn.y);
      await ctx.sleep(1.5 + Math.random() * 1.0);   // 1.5-2.5s
      break;
    }
    await fs.unlink(addTeamRegionPath).catch(() => {});
    ctx.log(`  有空闲队伍，继续`);

    // [6/7] 点击选择队伍按钮
    ctx.log(`  [6/7] 点击选择队伍按钮 (${SELECT_TEAM_BUTTON.x}, ${SELECT_TEAM_BUTTON.y})`);
    await ctx.tap(SELECT_TEAM_BUTTON.x, SELECT_TEAM_BUTTON.y);
    await ctx.sleep(1);

    // 检测分页（仅首轮）
    if (hasPaging === null) {
      hasPaging = await ctx.findImage(PAGE_INDICATOR_TEMPLATE, 0.8);
      ctx.log(`  [检测] 换页按钮: ${hasPaging ? '存在 (>7组)' : '不存在 (≤7组)'}`);
    }

    // [7/7] 弹窗内逐个尝试队伍，从上一次派出队伍的下一个开始
    const teamButtons = (hasPaging ?? false) ? TEAM_BUTTONS_PAGED : TEAM_BUTTONS_NO_PAGE;
    let dispatchedThisGem = false;
    let allTeamsBusy = false;

    if (nextTeamIdx >= teams.length) {
      ctx.log(`  所有配置队伍已派出（${teams.length}队），任务完成，关闭弹窗`);
      await ctx.tap(CLOSE_POPUP_BUTTON.x, CLOSE_POPUP_BUTTON.y);
      await ctx.sleep(0.5);
      break;
    }

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

      // 点击行军
      await ctx.sleep(0.3 + Math.random() * 0.4);  // 0.3-0.7s
      ctx.log(`  点击行军按钮 (${MARCH_BUTTON.x}, ${MARCH_BUTTON.y})`);
      await ctx.tap(MARCH_BUTTON.x, MARCH_BUTTON.y);
      await ctx.sleep(0.8 + Math.random() * 0.7);   // 0.8-1.5s

      dispatched++;
      nextTeamIdx = (ti === teams.length - 1) ? 0 : ti + 1;
      ctx.log(`  ✅ 队伍${tryTeam} 已派出采集宝石矿（累计 ${dispatched} 队，下次从第${nextTeamIdx + 1}队开始）`);

      // 记录当前中心坐标，避免后续重复采集
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

      // OCR 检测剩余空闲队伍数（1507,169 - 1562,200）
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
            ctx.log(`  ⏭️ 队伍已全部派出 (${used}/${total})，停止宝石采集`);
            allTeamsBusy = true;
          } else {
            ctx.log(`  剩余空闲队伍: ${total - used} (${used}/${total})`);
          }
        }
      } finally {
        await fs.unlink(teamRegionPath).catch(() => {});
      }

      if (allTeamsBusy) {
        dispatchedThisGem = true;
        break;
      }

      // dirSwipes 已记录当前方向进度，恢复螺旋时自动从剩余次数接续，无需人为进位

      dispatchedThisGem = true;
      break;  // 队伍已派出，退出 for 循环
    }  // end for (try teams in popup)

    if (!dispatchedThisGem) {
      ctx.log(`  所有队伍不可用，任务完成，关闭弹窗`);
      await ctx.tap(CLOSE_POPUP_BUTTON.x, CLOSE_POPUP_BUTTON.y);
      await ctx.sleep(0.5);
      break;
    }

    if (allTeamsBusy) {
      ctx.log(`  队伍已全部派出，任务完成`);
      break;
    }

    // 缩地后接续螺旋搜索下一颗矿
    await doZoomOut();
    await ctx.sleep(1);
  }

  ctx.log(`=== 宝石采集完成：派出 ${dispatched} 队 ===`);
  return { result: dispatched > 0 ? 'success' : 'not_found', dispatched };
}
