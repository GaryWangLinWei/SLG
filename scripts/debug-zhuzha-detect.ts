/**
 * 直接跑 state.onnx 检测所有 zhuzha_zero_*.png 截图。
 * 运行：npx ts-node scripts/debug-zhuzha-detect.ts
 */
import * as fs from 'fs';
import * as path from 'path';
import { YoloDetector } from '../core/vision/YoloDetector';

const DEBUG_DIR = 'D:/SLG/temp/debug/shared_gem';
const MODEL_PATH = 'D:/SLG/plugins/rok/models/state.onnx';

const CLASS_INDEX_STATE: Record<number, string> = {
  0: 'back',
  1: 'caiji',
  2: 'totarget',
  3: 'zhuzha',
};
const STATE_DETECT_THRESHOLD = 0.35;
const STATE_CONF_THRESHOLD = 0.35;
const STATUS_REGION = { x: 1530, y: 150, w: 52, h: 630 };

function inRegion(x: number, y: number, r: { x: number; y: number; w: number; h: number }): boolean {
  return x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h;
}

async function main() {
  if (!fs.existsSync(MODEL_PATH)) throw new Error(`模型不存在: ${MODEL_PATH}`);
  if (!fs.existsSync(DEBUG_DIR)) throw new Error(`目录不存在: ${DEBUG_DIR}`);

  console.log('加载模型...');
  const detector = await YoloDetector.create(MODEL_PATH);

  const images = fs
    .readdirSync(DEBUG_DIR)
    .filter(f => f.startsWith('zhuzha_zero_') && f.endsWith('.png'))
    .map(f => path.join(DEBUG_DIR, f));
  console.log(`找到 ${images.length} 张截图\n`);

  let missCount = 0;
  let regionMissCount = 0;
  let hitCount = 0;

  for (const imgPath of images) {
    const name = path.basename(imgPath);
    const dets = await detector.detect(imgPath, STATE_DETECT_THRESHOLD, 0.45, [0, 1, 2, 3]);
    const zhuzha = dets.filter(d => d.classIndex === 3);
    const filtered = zhuzha.filter(d =>
      d.confidence >= STATE_CONF_THRESHOLD &&
      inRegion(Math.round(d.x), Math.round(d.y), STATUS_REGION)
    );

    console.log(`=== ${name} ===`);
    console.log(`  原始检测: ${dets.length} 个`);
    for (const d of dets) {
      const state = CLASS_INDEX_STATE[d.classIndex] ?? `cls${d.classIndex}`;
      const x = Math.round(d.x);
      const y = Math.round(d.y);
      const inR = inRegion(x, y, STATUS_REGION);
      console.log(`    [${state}] (${x},${y}) conf=${(d.confidence * 100).toFixed(1)}% ${inR ? 'IN' : 'OUT'}`);
    }
    console.log(`  zhuzha 原始 ${zhuzha.length}，过滤后 ${filtered.length}\n`);

    if (zhuzha.length === 0) missCount++;
    else if (filtered.length === 0) regionMissCount++;
    else hitCount++;
  }

  console.log(`\n============ 汇总 ============`);
  console.log(`共 ${images.length} 张`);
  console.log(`  模型完全没检测到 zhuzha: ${missCount}`);
  console.log(`  检测到但被区域/阈值过滤:   ${regionMissCount}`);
  console.log(`  过滤后仍有命中:            ${hitCount}`);
}

main().catch(e => { console.error(e); process.exit(1); });
