import { Vision } from '../core/vision/Vision';
import { getTemplatesDir } from '../core/resourcePath';
import * as path from 'path';
import * as fs from 'fs/promises';
import sharp from 'sharp';

const SCREENSHOT_DIR = 'C:\\Users\\54459\\Desktop\\Test';
const OUTPUT_DIR = path.join(SCREENSHOT_DIR, 'output');
const TEMPLATE_DIR = getTemplatesDir();
const BAOSHI_TEMPLATES = ['baoshi.png', 'baoshi_night.png', 'baoshi_afternoon.png'].map(t => path.join(TEMPLATE_DIR, t));
const SCREENSHOTS = ['day1.png', 'day2.png', 'day3.png'];

async function drawRect(
  imagePath: string,
  outputPath: string,
  matches: Array<{ x: number; y: number; w: number; h: number; confidence: number }>
) {
  const image = sharp(imagePath);
  const metadata = await image.metadata();

  // Build SVG overlay with rectangles
  const svgRects = matches.map((m, i) => {
    const color = m.confidence >= 0.85 ? 'lime' : m.confidence >= 0.75 ? 'yellow' : 'orange';
    return `
      <rect x="${m.x}" y="${m.y}" width="${m.w}" height="${m.h}"
            fill="none" stroke="${color}" stroke-width="2" />
      <text x="${m.x}" y="${m.y - 2}" fill="${color}" font-size="12" font-family="Arial">
        #${i + 1} ${(m.confidence * 100).toFixed(0)}%
      </text>`;
  }).join('');

  const svg = `
    <svg width="${metadata.width}" height="${metadata.height}" xmlns="http://www.w3.org/2000/svg">
      ${svgRects}
    </svg>`;

  await image
    .composite([{ input: Buffer.from(svg), top: 0, left: 0 }])
    .toFile(outputPath);
}

async function main() {
  const vision = new Vision();
  await fs.mkdir(OUTPUT_DIR, { recursive: true });

  for (const screenshot of SCREENSHOTS) {
    const screenshotPath = path.join(SCREENSHOT_DIR, screenshot);
    console.log(`\n=== ${screenshot} ===`);

    // Multi-template search
    console.log(`  多模板搜索中...`);
    const results = await vision.findAllImagesMultiTemplate(
      screenshotPath, BAOSHI_TEMPLATES, 0.7, [0.8, 0.9, 1.0]
    );
    console.log(`  找到 ${results.length} 个宝石矿`);

    // Log details
    results.forEach((r: any, i: number) => {
      console.log(`    #${i + 1}: (${r.location.x}, ${r.location.y}) conf=${r.confidence.toFixed(3)} size=${r.rect.width}x${r.rect.height}`);
    });

    // Draw and save
    const matchRects = results.map((r: any) => ({
      x: r.rect.x,
      y: r.rect.y,
      w: r.rect.width,
      h: r.rect.height,
      confidence: r.confidence,
    }));

    const outputPath = path.join(OUTPUT_DIR, screenshot.replace('.png', '_marked.png'));
    await drawRect(screenshotPath, outputPath, matchRects);
    console.log(`  已保存: ${outputPath}`);
  }

  console.log('\n=== 完成 ===');
  console.log(`标注截图保存在: ${OUTPUT_DIR}`);
}

main().catch(console.error);
