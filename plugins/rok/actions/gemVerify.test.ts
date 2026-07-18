import * as fs from 'fs/promises';
import * as path from 'path';
import sharp from 'sharp';
import { Vision } from '../../../core/vision/Vision';

const FAIL_DIR = 'D:/SLG/temp/debug/gem_verify_fail';
const TEMPLATE_DIR = path.join(__dirname, '..', 'templates', 'gem');
const TEMPLATES = [
  'dayGem.png',
  'afternoonGem.png',
  'nightGem.png',
  'gem_old_day.png',
  'gem_old_night.png',
].map(f => path.join(TEMPLATE_DIR, f));

// 与 gatherGem.ts:47 保持一致
const REGION = { x: 800 - 150, y: 450 - 150, w: 300, h: 300 };
const THRESHOLD = 0.65;

const TMP_DIR = path.join(process.cwd(), 'temp', 'test-gem-verify');

async function cropCenter(srcPath: string): Promise<string> {
  await fs.mkdir(TMP_DIR, { recursive: true });
  const out = path.join(TMP_DIR, path.basename(srcPath));
  await sharp(srcPath)
    .extract({ left: REGION.x, top: REGION.y, width: REGION.w, height: REGION.h })
    .toFile(out);
  return out;
}

describe('gem verify — 复检 fail 截图', () => {
  const vision = new Vision();
  let files: string[] = [];

  beforeAll(async () => {
    const entries = await fs.readdir(FAIL_DIR).catch(() => [] as string[]);
    files = entries.filter(f => f.endsWith('.png')).map(f => path.join(FAIL_DIR, f));
  });

  afterAll(async () => {
    await fs.rm(TMP_DIR, { recursive: true, force: true }).catch(() => {});
  });

  it(`fail_dir 应存在且非空`, () => {
    expect(files.length).toBeGreaterThan(0);
  });

  it('逐张复检并报告能识别为宝石的数量', async () => {
    const results: Array<{ file: string; conf: number; hit: boolean; confFull: number }> = [];
    for (const full of files) {
      const cropped = await cropCenter(full);
      let best = 0;
      for (const tpl of TEMPLATES) {
        const r = await vision.findImage(cropped, tpl, THRESHOLD);
        if (r.confidence > best) best = r.confidence;
      }
      // 全图复检（不裁剪），排除区域外命中
      let bestFull = 0;
      for (const tpl of TEMPLATES) {
        const r = await vision.findImage(full, tpl, THRESHOLD);
        if (r.confidence > bestFull) bestFull = r.confidence;
      }
      results.push({ file: path.basename(full), conf: best, hit: best >= THRESHOLD, confFull: bestFull });
    }
    // 打印明细
    for (const r of results) {
      console.log(`  ${r.hit ? '✅' : '❌'} ${r.file}  region=${(r.conf * 100).toFixed(1)}%  full=${(r.confFull * 100).toFixed(1)}%`);
    }
    const hits = results.filter(r => r.hit).length;
    console.log(`\n=== 汇总: ${hits}/${results.length} 张可识别为宝石 ===`);
    expect(results.length).toBe(files.length);
  }, 120_000);
});
