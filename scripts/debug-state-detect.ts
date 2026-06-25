import { YoloDetector } from '../core/vision/YoloDetector';
import { getModelsDir } from '../core/resourcePath';
import * as path from 'path';
import * as fs from 'fs/promises';
import sharp from 'sharp';

// state.onnx 真实检测调试脚本：对截图检测队伍状态，把红框 + 类别 + 置信度画到图上保存。
// 运行：npx ts-node scripts/debug-state-detect.ts [图片路径] [阈值]
// 类别：0=返回 1=采集 2=行军 3=驻扎

const STATE_NAMES: Record<number, string> = {
  0: '返回',
  1: '采集',
  2: '行军',
  3: '驻扎',
};

const MODEL_PATH = path.join(getModelsDir(), 'state.onnx');
const IMAGE_PATH = process.argv[2] || 'D:/SLG/temp/debug/focus/state_1782139598601.png';
const THRESHOLD = Number(process.argv[3]) || 0.5;
const OUTPUT_PATH = IMAGE_PATH.replace(/\.png$/i, '_detected.png');

async function main() {
  console.log(`模型: ${MODEL_PATH}`);
  console.log(`图片: ${IMAGE_PATH}`);
  console.log(`阈值: ${THRESHOLD}`);

  const detector = await YoloDetector.create(MODEL_PATH);
  const dets = await detector.detect(IMAGE_PATH, THRESHOLD, 0.45, [0, 1, 2, 3]);

  console.log(`\n=== 检测结果（共 ${dets.length} 个）===`);
  for (const d of dets) {
    const name = STATE_NAMES[d.classIndex] ?? `cls${d.classIndex}`;
    console.log(
      `  [${name}] 中心(${Math.round(d.x)},${Math.round(d.y)}) ` +
      `框 ${Math.round(d.width)}x${Math.round(d.height)} ` +
      `置信度 ${(d.confidence * 100).toFixed(1)}%`
    );
  }

  // 画红框 + 置信度
  const meta = await sharp(IMAGE_PATH).metadata();
  const W = meta.width!;
  const H = meta.height!;
  let svg = `<svg width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg">`;
  for (const d of dets) {
    const name = STATE_NAMES[d.classIndex] ?? `cls${d.classIndex}`;
    const bx = Math.round(d.x - d.width / 2);
    const by = Math.round(d.y - d.height / 2);
    const bw = Math.round(d.width);
    const bh = Math.round(d.height);
    const label = `${name} ${(d.confidence * 100).toFixed(1)}%`;
    const textW = label.length * 9 + 10;
    svg += `
      <rect x="${bx}" y="${by}" width="${bw}" height="${bh}" fill="none" stroke="red" stroke-width="2"/>
      <rect x="${bx}" y="${Math.max(0, by - 18)}" width="${textW}" height="18" fill="red" opacity="0.85"/>
      <text x="${bx + 4}" y="${Math.max(13, by - 4)}" font-family="Arial" font-size="13" font-weight="bold" fill="white">${label}</text>`;
  }
  if (dets.length === 0) {
    svg += `<text x="${W / 2}" y="${H / 2}" font-family="Arial" font-size="24" fill="red" text-anchor="middle">无匹配</text>`;
  }
  svg += '</svg>';

  await sharp(IMAGE_PATH)
    .composite([{ input: Buffer.from(svg), top: 0, left: 0 }])
    .toFile(OUTPUT_PATH);
  console.log(`\n标注截图已保存: ${OUTPUT_PATH}`);
}

main().catch(e => { console.error(e); process.exit(1); });
