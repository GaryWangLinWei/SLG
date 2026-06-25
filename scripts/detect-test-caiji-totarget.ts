import { YoloDetector } from '../core/vision/YoloDetector';
import { getModelsDir } from '../core/resourcePath';
import * as path from 'path';
import * as fs from 'fs/promises';
import sharp from 'sharp';

// 批量检测 Test 目录中所有图片的「采集」「行军」状态，画红框 + 置信度。
// 运行：npx ts-node scripts/detect-test-caiji-totarget.ts [阈值]
// 类别：1=采集 2=行军

const STATE_NAMES: Record<number, string> = { 1: '采集', 2: '行军' };
const CLASSES = [1, 2];

const TEST_DIR = 'C:/Users/54459/Desktop/Test';
const OUT_DIR = 'C:/Users/54459/Desktop/Test/detected';
const MODEL_PATH = path.join(getModelsDir(), 'state.onnx');
const THRESHOLD = Number(process.argv[2]) || 0.35;

async function main() {
  console.log(`模型: ${MODEL_PATH}\n阈值: ${THRESHOLD}`);
  await fs.mkdir(OUT_DIR, { recursive: true });
  const detector = await YoloDetector.create(MODEL_PATH);

  const files = (await fs.readdir(TEST_DIR)).filter(f => /\.(png|jpe?g)$/i.test(f));
  console.log(`共 ${files.length} 张图片\n`);

  for (const file of files) {
    const imgPath = path.join(TEST_DIR, file);
    const dets = await detector.detect(imgPath, THRESHOLD, 0.45, CLASSES);

    const summary = dets
      .map(d => `${STATE_NAMES[d.classIndex]} ${(d.confidence * 100).toFixed(1)}%`)
      .join(', ');
    console.log(`[${file}] ${dets.length} 个: ${summary || '无'}`);

    const meta = await sharp(imgPath).metadata();
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

    const outPath = path.join(OUT_DIR, file.replace(/\.(png|jpe?g)$/i, '_detected.png'));
    await sharp(imgPath).composite([{ input: Buffer.from(svg), top: 0, left: 0 }]).toFile(outPath);
  }

  console.log(`\n标注截图已保存到: ${OUT_DIR}`);
}

main().catch(e => { console.error(e); process.exit(1); });
