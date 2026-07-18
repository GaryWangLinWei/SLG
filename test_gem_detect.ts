import * as path from 'path';
import * as fs from 'fs/promises';
import sharp from 'sharp';
import { YoloDetector } from './core/vision/YoloDetector';

const MODEL_PATH = 'D:/SLG/plugins/rok/models/gem.onnx';
const INPUT_DIR = 'C:/Users/54459/Desktop/afternoongem/image';
const OUTPUT_DIR = 'C:/Users/54459/Desktop/afternoongem/output';

// 宝石类别颜色（红框）
const COLORS: Record<number, [number, number, number]> = {
  0: [255, 0, 0],    // gem - 红色
  1: [0, 255, 0],    // class 1 - 绿色
  2: [0, 0, 255],    // class 2 - 蓝色
};

async function drawDetections(
  imagePath: string,
  detections: { x: number; y: number; width: number; height: number; confidence: number; classIndex: number }[]
): Promise<Buffer> {
  const image = sharp(imagePath);
  const meta = await image.metadata();
  const w = meta.width || 1600;
  const h = meta.height || 900;

  // 创建 SVG 覆盖层
  let svg = `<svg width="${w}" height="${h}" xmlns="http://www.w3.org/2000/svg">`;

  for (const det of detections) {
    const color = COLORS[det.classIndex] || [255, 0, 0];
    const colorStr = `rgb(${color[0]},${color[1]},${color[2]})`;

    // 边界框
    svg += `<rect x="${det.x - det.width / 2}" y="${det.y - det.height / 2}"
                  width="${det.width}" height="${det.height}"
                  fill="none" stroke="${colorStr}" stroke-width="3"/>`;

    // 背景矩形
    const label = `gem ${(det.confidence * 100).toFixed(1)}%`;
    const labelW = 90;
    const labelH = 22;
    svg += `<rect x="${det.x - det.width / 2}" y="${det.y - det.height / 2 - labelH}"
                  width="${labelW}" height="${labelH}" fill="${colorStr}" opacity="0.8"/>`;

    // 文字
    svg += `<text x="${det.x - det.width / 2 + 5}" y="${det.y - det.height / 2 - 6}"
                  font-family="Arial" font-size="14" fill="white" font-weight="bold">${label}</text>`;
  }

  svg += '</svg>';

  // 合成图像
  return image
    .composite([{ input: Buffer.from(svg), top: 0, left: 0 }])
    .png()
    .toBuffer();
}

async function main() {
  // 创建输出目录
  await fs.mkdir(OUTPUT_DIR, { recursive: true });

  // 初始化检测器
  console.log('加载 gem.onnx 模型...');
  const detector = await YoloDetector.create(MODEL_PATH);

  // 获取前6张图片
  const files = await fs.readdir(INPUT_DIR);
  const imageFiles = files.filter(f => f.endsWith('.png')).slice(0, 6);

  console.log(`找到 ${imageFiles.length} 张测试图片`);
  console.log('='.repeat(60));

  // 逐个检测
  for (const file of imageFiles) {
    const inputPath = path.join(INPUT_DIR, file);
    const outputPath = path.join(OUTPUT_DIR, `det_${file}`);

    console.log(`\n检测: ${file}`);

    try {
      // 运行检测（所有类别）
      const detections = await detector.detect(inputPath, 0.1, 0.45, [0, 1, 2]);

      console.log(`  检测到 ${detections.length} 个目标:`);
      for (const det of detections) {
        console.log(`    - class=${det.classIndex}, conf=${det.confidence.toFixed(4)}, bbox=(${det.x},${det.y}) ${det.width}x${det.height}`);
      }

      // 画框并保存
      if (detections.length > 0) {
        const resultBuffer = await drawDetections(inputPath, detections);
        await fs.writeFile(outputPath, resultBuffer);
        console.log(`  已保存: ${outputPath}`);
      } else {
        // 没有检测到，直接复制原图
        await fs.copyFile(inputPath, outputPath);
        console.log(`  未检测到目标，复制原图`);
      }
    } catch (e) {
      console.log(`  错误: ${e}`);
    }
  }

  console.log('\n' + '='.repeat(60));
  console.log('测试完成! 结果保存在:', OUTPUT_DIR);
}

main().catch(console.error);
