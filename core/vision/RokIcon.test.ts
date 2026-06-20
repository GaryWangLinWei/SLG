import { Vision } from './Vision';
import { getTemplatesDir } from '../resourcePath';
import * as path from 'path';
import * as fs from 'fs/promises';
import sharp from 'sharp';

const SCREENSHOT = 'C:\\Users\\54459\\Desktop\\新建文件夹 (3)\\QQ20260620-152423.png';
const ROK_ICON_TEMPLATE = path.join(getTemplatesDir(), 'RokIcon.png');
const OUTPUT_DIR = path.join(process.cwd(), 'temp', 'rokicon_test');
// 桌面图标搜索区域（与 launchGame 保持一致）
const ICON_SEARCH_REGION = { x: 324, y: 256, width: 907, height: 542 };
const THRESHOLD = 0.8;
const SCALES = [0.9, 1.0, 1.1];

describe('RokIcon 桌面图标模板匹配', () => {
  let vision: Vision;

  beforeEach(() => {
    vision = new Vision();
  });

  // ====== 第一步：从截图中裁出图标创建模板 ======
  // 仅当模板不存在时运行；图标在桌面上的大致区域需要你手动指定
  it('Step 1: 从截图中裁剪图标区域创建 RokIcon.png 模板', async () => {
    // 检查模板是否已存在
    try { await fs.access(ROK_ICON_TEMPLATE); } catch { /* 不存在 */ }

    // 先在截图中盲扫一遍（整个搜索区域），找到可能的图标位置
    console.log(`\n📷 截图: ${SCREENSHOT}`);
    console.log(`🔍 搜索区域: (${ICON_SEARCH_REGION.x}, ${ICON_SEARCH_REGION.y}) ${ICON_SEARCH_REGION.width}x${ICON_SEARCH_REGION.height}`);

    const meta = await sharp(SCREENSHOT).metadata();
    console.log(`📐 截图尺寸: ${meta.width}x${meta.height}`);

    // 先裁出搜索区域保存，方便你手动从中再裁图标
    const cropPath = path.join(OUTPUT_DIR, 'desktop_search_region.png');
    await fs.mkdir(OUTPUT_DIR, { recursive: true });
    await sharp(SCREENSHOT)
      .extract({ left: ICON_SEARCH_REGION.x, top: ICON_SEARCH_REGION.y, width: ICON_SEARCH_REGION.width, height: ICON_SEARCH_REGION.height })
      .toFile(cropPath);
    console.log(`📁 搜索区域已导出: ${cropPath}`);
    console.log(`\n⚠️  RokIcon.png 模板尚不存在，请执行以下操作:`);
    console.log(`   1. 打开上述搜索区域截图，找到万国觉醒图标`);
    console.log(`   2. 用图片编辑器裁出图标本身（建议只裁图标 + 透明背景）`);
    console.log(`   3. 保存为: ${ROK_ICON_TEMPLATE}`);
    console.log(`   4. 重新运行本测试（自动跳过 Step 1，执行 Step 2）\n`);
  }, 10000);

  // ====== 第二步：模板匹配 + 红框标注 ======
  it('Step 2: 匹配 RokIcon.png 并红框标注置信度', async () => {
    // 确保模板存在
    try {
      await fs.access(ROK_ICON_TEMPLATE);
    } catch {
      console.warn('⚠️  RokIcon.png 不存在，请先运行 Step 1 创建模板');
      return;
    }

    const tplMeta = await sharp(ROK_ICON_TEMPLATE).metadata();
    console.log(`\n📷 模板: RokIcon.png (${tplMeta.width}x${tplMeta.height})`);
    console.log(`🎯 阈值: ${THRESHOLD}  缩放: [${SCALES.join(', ')}]`);

    const startTime = Date.now();

    // 在整张截图中搜索
    const result = await vision.findImage(SCREENSHOT, ROK_ICON_TEMPLATE, THRESHOLD, SCALES);

    // 同时在搜索区域内搜索（精确匹配）
    const regionResult = await vision.findImage(SCREENSHOT, ROK_ICON_TEMPLATE, THRESHOLD, SCALES);

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    console.log(`\n⏱  耗时: ${elapsed}s`);
    console.log(`✅ 找到: ${result.found}`);
    console.log(`📍 位置: (${result.location.x}, ${result.location.y})`);
    console.log(`📊 置信度: ${(result.confidence * 100).toFixed(1)}%`);
    console.log(`📐 匹配框: (${result.rect.x}, ${result.rect.y}) ${result.rect.width}x${result.rect.height}`);

    // 红框标注保存
    await fs.mkdir(OUTPUT_DIR, { recursive: true });

    if (result.found) {
      const img = sharp(SCREENSHOT);
      const color = result.confidence >= 0.85 ? 'red' : 'orange';
      // 生成 SVG 叠加层：红色矩形 + 置信度文字
      const svg = `<svg width="${1600}" height="${900}" xmlns="http://www.w3.org/2000/svg">
        <rect x="${result.rect.x}" y="${result.rect.y}" width="${result.rect.width}" height="${result.rect.height}" fill="none" stroke="${color}" stroke-width="3"/>
        <text x="${result.rect.x}" y="${result.rect.y - 6}" fill="${color}" font-size="18" font-family="Arial" font-weight="bold">RokIcon ${(result.confidence * 100).toFixed(0)}%</text>
      </svg>`;

      const outPath = path.join(OUTPUT_DIR, 'rokicon_matched.png');
      await img.composite([{ input: Buffer.from(svg), top: 0, left: 0 }]).toFile(outPath);
      console.log(`🖼️  标注截图已保存: ${outPath}`);
    } else {
      console.log(`⚠️  未匹配到图标（最高原始置信度: ${(result.confidence * 100).toFixed(1)}%）`);
      console.log(`💡 建议: 降低阈值重试，或检查模板是否与截图中的图标一致（尺寸/颜色/背景）`);
    }

    // 输出置信度用于断言
    expect(result.confidence).toBeGreaterThan(0);
  }, 30000);
});
