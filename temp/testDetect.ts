import { YoloDetector } from '../core/vision/YoloDetector';
import * as path from 'path';
import * as fs from 'fs/promises';
import sharp from 'sharp';

async function main() {
  console.log('Loading model...');
  const d = await YoloDetector.create(path.join(__dirname, '..', 'plugins/rok/models/gem.onnx'));
  console.log('Model loaded\n');

  const testDir = 'C:/Users/54459/Desktop/baoshiTest';
  const outDir = path.join(testDir, 'result');
  await fs.mkdir(outDir, { recursive: true });

  const files = (await fs.readdir(testDir))
    .filter(f => f.endsWith('.png'))
    .sort();

  for (const f of files) {
    const fp = path.join(testDir, f);
    const meta = await sharp(fp).metadata();
    const dets = await d.detect(fp, 0.5);
    console.log(`${f}: ${dets.length} gems`);

    let svgRects = '';
    for (const det of dets) {
      const ratio = (det.width / det.height).toFixed(2);
      const x1 = det.x - det.width / 2;
      const y1 = det.y - det.height / 2;
      const isSuspect = det.height > det.width;
      const color = isSuspect ? 'red' : (det.confidence >= 0.8 ? 'lime' : 'yellow');
      const label = `${(det.confidence * 100).toFixed(0)}% w/h=${ratio}${isSuspect ? ' ✗' : ' ✓'}`;
      console.log(`  x=${det.x} y=${det.y} w=${det.width} h=${det.height} w/h=${ratio} conf=${det.confidence.toFixed(4)} ${isSuspect ? '<- 干扰' : ''}`);
      svgRects += `<rect x="${x1}" y="${y1}" width="${det.width}" height="${det.height}" fill="none" stroke="${color}" stroke-width="2"/>\n`;
      svgRects += `<text x="${x1}" y="${y1 - 3}" fill="${color}" font-size="13" font-family="Arial" font-weight="bold">${label}</text>\n`;
    }
    if (dets.length === 0) {
      svgRects = `<text x="20" y="30" fill="red" font-size="20" font-family="Arial" font-weight="bold">NO GEMS</text>\n`;
    }

    const svg = `<svg width="${meta.width}" height="${meta.height}" xmlns="http://www.w3.org/2000/svg">\n${svgRects}</svg>`;
    const outPath = path.join(outDir, f.replace('.png', '_marked.png'));
    await sharp(fp).composite([{ input: Buffer.from(svg), top: 0, left: 0 }]).toFile(outPath);
  }
  console.log(`\nDone → ${outDir}`);
}

main().catch(e => { console.error('FAIL:', e.message || e); process.exit(1); });
