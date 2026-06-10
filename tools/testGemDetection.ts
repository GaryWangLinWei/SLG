/**
 * YOLO 宝石检测可视化测试脚本
 * 用法: npx ts-node tools/testGemDetection.ts <图片目录或单张图片路径>
 * 示例: npx ts-node tools/testGemDetection.ts C:/Users/54459/Desktop/baoshiTest
 * 结果保存到 D:/SLG/temp/
 */
import { YoloDetector, Detection } from '../core/vision/YoloDetector';
import * as path from 'path';
import * as fs from 'fs';

const OUTPUT_DIR = 'D:/SLG/temp';
const MODEL_PATH = path.join(__dirname, '..', 'plugins/rok/models/gem.onnx');

async function drawDetections(
  imagePath: string,
  detections: Detection[],
  outputPath: string
): Promise<void> {
  const sharp = require('sharp');

  // Build SVG overlay with red boxes + confidence labels
  const metadata = await sharp(imagePath).metadata();
  const imgW = metadata.width!;
  const imgH = metadata.height!;

  let svgOverlay = `<svg width="${imgW}" height="${imgH}" xmlns="http://www.w3.org/2000/svg">`;

  for (const d of detections) {
    // x, y 是中心坐标，转左上角
    const x1 = d.x - d.width / 2;
    const y1 = d.y - d.height / 2;
    const x2 = d.x + d.width / 2;
    const y2 = d.y + d.height / 2;
    const label = d.confidence.toFixed(3);

    svgOverlay += `
      <rect x="${x1}" y="${y1}" width="${x2 - x1}" height="${y2 - y1}"
            fill="none" stroke="red" stroke-width="2"/>
      <rect x="${x1}" y="${y1 - 20}" width="${label.length * 10 + 8}" height="20"
            fill="red"/>
      <text x="${x1 + 4}" y="${y1 - 5}" font-family="Arial" font-size="14"
            fill="white">${label}</text>`;
  }
  svgOverlay += '</svg>';

  await sharp(imagePath)
    .composite([{ input: Buffer.from(svgOverlay), top: 0, left: 0 }])
    .toFile(outputPath);

  // Also save a text report
  const reportPath = outputPath.replace('.png', '.txt');
  let report = `File: ${path.basename(imagePath)}\n`;
  report += `Detections: ${detections.length}\n\n`;
  for (let i = 0; i < detections.length; i++) {
    const d = detections[i];
    report += `  [${i}] x=${d.x} y=${d.y} w=${d.width} h=${d.height} conf=${d.confidence.toFixed(4)}\n`;
  }
  fs.writeFileSync(reportPath, report);
}

async function main() {
  const input = process.argv[2];
  if (!input) {
    console.error('用法: npx ts-node tools/testGemDetection.ts <图片路径或目录>');
    process.exit(1);
  }

  console.log('加载模型...');
  const detector = await YoloDetector.create(MODEL_PATH);
  console.log('模型加载完成\n');

  // 收集图片文件
  const files: string[] = [];
  const stat = fs.statSync(input);
  if (stat.isDirectory()) {
    for (const f of fs.readdirSync(input)) {
      if (f.toLowerCase().endsWith('.png')) {
        files.push(path.join(input, f));
      }
    }
  } else if (input.toLowerCase().endsWith('.png')) {
    files.push(input);
  } else {
    console.error('输入必须是 .png 文件或包含 .png 的目录');
    process.exit(1);
  }

  files.sort();

  for (const file of files) {
    const basename = path.basename(file);
    const outputPath = path.join(OUTPUT_DIR, basename);
    console.log(`${basename}...`);
    try {
      const detections = await detector.detect(file, 0.5);
      console.log(`  检出 ${detections.length} 个宝石`);
      await drawDetections(file, detections, outputPath);
      console.log(`  已保存: ${outputPath}`);
    } catch (e: any) {
      console.error(`  失败: ${e.message}`);
    }
  }

  console.log(`\n全部完成，结果在: ${OUTPUT_DIR}`);
}

main().catch(e => { console.error(e); process.exit(1); });
