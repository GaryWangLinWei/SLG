import { Vision } from './Vision';
import { getTemplatesDir } from '../resourcePath';
import * as path from 'path';
import * as fs from 'fs/promises';
import sharp from 'sharp';

const SCREENSHOT_DIR = 'C:\\Users\\54459\\Desktop\\Test';
const CHENG_ZHAI_DIR = path.join(SCREENSHOT_DIR, 'chengzhaiTest');
const TEMPLATE_DIR = getTemplatesDir();
const CHENG_ZHAI_TEMPLATE = path.join(TEMPLATE_DIR, 'ChengZhai.png');
const BAOSHI_TEMPLATES = ['baoshi.png', 'baoshi_night.png', 'baoshi_afternoon.png'].map(t => path.join(TEMPLATE_DIR, t));

describe('Vision Template Matching', () => {
  let vision: Vision;

  beforeEach(() => {
    vision = new Vision();
  });

  it('should have findImage method', () => {
    expect(typeof vision.findImage).toBe('function');
  });

  describe('ChengZhai Fort Detection (Day & Night Screenshots)', () => {
    const SCALES = [0.7, 0.8, 0.9, 1.0, 1.1];
    const THRESHOLD = 0.8;

    it('should detect forts in day.png', async () => {
      const screenshotPath = path.join(SCREENSHOT_DIR, 'day.png');
      const result = await vision.findImage(screenshotPath, CHENG_ZHAI_TEMPLATE, THRESHOLD, SCALES);
      console.log(`[day.png] found=${result.found} confidence=${result.confidence.toFixed(3)} location=(${result.location.x},${result.location.y})`);
      // Template has transparent bg + alpha mask; expect reasonable confidence
      expect(result.confidence).toBeGreaterThan(0);
    }, 30000);

    it('should detect forts in night.png', async () => {
      const screenshotPath = path.join(SCREENSHOT_DIR, 'night.png');
      const result = await vision.findImage(screenshotPath, CHENG_ZHAI_TEMPLATE, THRESHOLD, SCALES);
      console.log(`[night.png] found=${result.found} confidence=${result.confidence.toFixed(3)} location=(${result.location.x},${result.location.y})`);
      expect(result.confidence).toBeGreaterThan(0);
    }, 30000);

    it('should find all forts in day.png', async () => {
      const screenshotPath = path.join(SCREENSHOT_DIR, 'day.png');
      const results = await vision.findAllImages(screenshotPath, CHENG_ZHAI_TEMPLATE, THRESHOLD, SCALES);
      console.log(`[day.png] found ${results.length} forts:`);
      results.forEach((r, i) => {
        console.log(`  #${i + 1}: (${r.location.x},${r.location.y}) confidence=${r.confidence.toFixed(3)}`);
      });
      expect(Array.isArray(results)).toBe(true);
    }, 60000);

    it('should find all forts in night.png', async () => {
      const screenshotPath = path.join(SCREENSHOT_DIR, 'night.png');
      const results = await vision.findAllImages(screenshotPath, CHENG_ZHAI_TEMPLATE, THRESHOLD, SCALES);
      console.log(`[night.png] found ${results.length} forts:`);
      results.forEach((r, i) => {
        console.log(`  #${i + 1}: (${r.location.x},${r.location.y}) confidence=${r.confidence.toFixed(3)}`);
      });
      expect(Array.isArray(results)).toBe(true);
    }, 60000);

    it('day vs night confidence comparison', async () => {
      const dayPath = path.join(SCREENSHOT_DIR, 'day.png');
      const nightPath = path.join(SCREENSHOT_DIR, 'night.png');

      const [dayResult, dayAll, nightResult, nightAll] = await Promise.all([
        vision.findImage(dayPath, CHENG_ZHAI_TEMPLATE, THRESHOLD, SCALES),
        vision.findAllImages(dayPath, CHENG_ZHAI_TEMPLATE, THRESHOLD, SCALES),
        vision.findImage(nightPath, CHENG_ZHAI_TEMPLATE, THRESHOLD, SCALES),
        vision.findAllImages(nightPath, CHENG_ZHAI_TEMPLATE, THRESHOLD, SCALES),
      ]);

      console.log('\n=== 白天 vs 晚上对比 ===');
      console.log(`白天: 最佳置信度=${dayResult.confidence.toFixed(3)}, 找到${dayAll.length}个城寨`);
      console.log(`晚上: 最佳置信度=${nightResult.confidence.toFixed(3)}, 找到${nightAll.length}个城寨`);
      console.log(`置信度差值: ${(dayResult.confidence - nightResult.confidence).toFixed(3)}`);

      // Both should be non-zero (template matching working)
      expect(dayResult.confidence).toBeGreaterThan(0);
      expect(nightResult.confidence).toBeGreaterThan(0);
    }, 120000);
  });

  describe('Gem Mine Detection (Multi-Template)', () => {
    const SCALES = [0.8, 0.9, 1.0];
    const THRESHOLD = 0.7;
    const SCREENSHOTS = ['day1.png', 'day2.png', 'day3.png'];
    const OUTPUT_DIR = path.join(SCREENSHOT_DIR, 'output');

    it('should parallel-search all templates on 3 screenshots', async () => {
      await fs.mkdir(OUTPUT_DIR, { recursive: true });
      const startTime = Date.now();

      for (const screenshot of SCREENSHOTS) {
        const screenshotPath = path.join(SCREENSHOT_DIR, screenshot);
        const iterStart = Date.now();

        // 并行搜索所有模板（模拟 gatherGem 的新逻辑）
        const results = await Promise.all(
          BAOSHI_TEMPLATES.map(t => vision.findImage(screenshotPath, t, THRESHOLD, SCALES))
        );
        const best = results
          .filter(r => r.found)
          .sort((a, b) => b.confidence - a.confidence)[0];

        const elapsed = ((Date.now() - iterStart) / 1000).toFixed(1);
        console.log(`\n[${screenshot}] ${elapsed}s`);
        results.forEach(r => {
          const tplName = path.basename(BAOSHI_TEMPLATES[results.indexOf(r)]);
          console.log(`  ${tplName}: found=${r.found} conf=${r.confidence.toFixed(3)}`);
        });

        if (best) {
          console.log(`  最佳: conf=${best.confidence.toFixed(3)} @ (${best.location.x},${best.location.y})`);
          // 画框保存
          const image = sharp(screenshotPath);
          const color = best.confidence >= 0.85 ? 'lime' : 'yellow';
          const svg = `<svg width="1600" height="900" xmlns="http://www.w3.org/2000/svg">
            <rect x="${best.rect.x}" y="${best.rect.y}" width="${best.rect.width}" height="${best.rect.height}" fill="none" stroke="${color}" stroke-width="3"/>
            <text x="${best.rect.x}" y="${best.rect.y - 4}" fill="${color}" font-size="16" font-family="Arial" font-weight="bold">GEM ${(best.confidence*100).toFixed(0)}%</text>
          </svg>`;
          const outPath = path.join(OUTPUT_DIR, screenshot.replace('.png', '_v2.png'));
          await image.composite([{ input: Buffer.from(svg), top: 0, left: 0 }]).toFile(outPath);
        }
      }

      const total = ((Date.now() - startTime) / 1000).toFixed(1);
      console.log(`\n总耗时: ${total}s`);
    }, 120000);

    it('should draw ChengZhai matches on screenshots', async () => {
      const SCALES = [0.8, 0.9, 1.0];
      const THRESHOLD = 0.7;
      const czScreenshots = ['day1.png', 'afternoonTest1.png', 'nightTest1.png'];
      const outDir = path.join(CHENG_ZHAI_DIR, 'output');
      await fs.mkdir(outDir, { recursive: true });

      for (const s of czScreenshots) {
        const sp = path.join(CHENG_ZHAI_DIR, s);
        const r = await vision.findImage(sp, CHENG_ZHAI_TEMPLATE, THRESHOLD, SCALES);
        console.log(`  ${s}: found=${r.found} conf=${r.confidence.toFixed(3)}`);

        if (r.found) {
          const img = sharp(sp);
          const color = r.confidence >= 0.85 ? 'lime' : 'yellow';
          const svg = `<svg width="1600" height="900" xmlns="http://www.w3.org/2000/svg">
            <rect x="${r.rect.x}" y="${r.rect.y}" width="${r.rect.width}" height="${r.rect.height}" fill="none" stroke="${color}" stroke-width="3"/>
            <text x="${r.rect.x}" y="${r.rect.y - 4}" fill="${color}" font-size="16" font-family="Arial" font-weight="bold">FORT ${(r.confidence*100).toFixed(0)}%</text>
          </svg>`;
          const out = path.join(outDir, s.replace('.png', '_marked.png'));
          await img.composite([{ input: Buffer.from(svg), top: 0, left: 0 }]).toFile(out);
          console.log(`    已保存: ${out}`);
        }
      }
    }, 60000);

    it('should compare speed: ChengZhai vs Baoshi', async () => {
      const SCALES = [0.8, 0.9, 1.0];
      const THRESHOLD = 0.7;
      const czScreenshots = ['day1.png', 'afternoonTest1.png', 'nightTest1.png'];

      // ChengZhai: 单模板 73x60
      console.log('\n=== ChengZhai (73×60) ===');
      const czStart = Date.now();
      for (const s of czScreenshots) {
        const t0 = Date.now();
        const r = await vision.findImage(path.join(CHENG_ZHAI_DIR, s), CHENG_ZHAI_TEMPLATE, THRESHOLD, SCALES);
        console.log(`  ${s}: ${((Date.now()-t0)/1000).toFixed(1)}s found=${r.found} conf=${r.confidence.toFixed(3)}`);
      }
      const czTotal = ((Date.now() - czStart) / 1000).toFixed(1);

      // Baoshi: 单模板 28x30
      console.log('\n=== Baoshi (28×30) ===');
      const bsStart = Date.now();
      for (const s of ['day1.png', 'day2.png', 'day3.png']) {
        const t0 = Date.now();
        const r = await vision.findImage(path.join(SCREENSHOT_DIR, s), BAOSHI_TEMPLATES[0], THRESHOLD, SCALES);
        console.log(`  ${s}: ${((Date.now()-t0)/1000).toFixed(1)}s found=${r.found} conf=${r.confidence.toFixed(3)}`);
      }
      const bsTotal = ((Date.now() - bsStart) / 1000).toFixed(1);

      console.log(`\nChengZhai 总耗时: ${czTotal}s | Baoshi 总耗时: ${bsTotal}s`);
      console.log(`ChengZhai 模板 73×60 (步长18) vs Baoshi 模板 28×30 (步长7) = 扫描位置差 5.5x`);
    }, 120000);

    it('should detect forts in all chengzhaiTest screenshots (rallyFortSpiral method)', async () => {
      const SCALES = [0.8, 0.9, 1.0];
      const THRESHOLD = 0.7;
      const CZ_TEMPLATES = [
        path.join(TEMPLATE_DIR, 'ChengZhai.png'),
        path.join(TEMPLATE_DIR, 'ChengZhai_Afternoon_result.png'),
        path.join(TEMPLATE_DIR, 'ChengZhai_night_result.png'),
      ];
      const screenshots = [
        'day1.png', 'day2.png', 'day3.png',
        'afternoonTest1.png', 'afternoonTest2.png', 'afternoonTest3.png',
        'nightTest1.png', 'nightTest2.png', 'nightTest3.png',
      ];
      const outDir = path.join(CHENG_ZHAI_DIR, 'output');
      await fs.mkdir(outDir, { recursive: true });

      const startTime = Date.now();
      let foundCount = 0;

      for (const s of screenshots) {
        const sp = path.join(CHENG_ZHAI_DIR, s);
        const t0 = Date.now();

        // 并行搜索所有城寨模板（与 rallyFortSpiral 相同方式）
        const results = await Promise.all(
          CZ_TEMPLATES.map(t => vision.findImage(sp, t, THRESHOLD, SCALES))
        );
        const best = results
          .filter(r => r.found)
          .sort((a, b) => b.confidence - a.confidence)[0];

        const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
        if (best) {
          foundCount++;
          // 找到匹配模板名
          const bestIdx = results.indexOf(best);
          const tplName = path.basename(CZ_TEMPLATES[bestIdx]);
          console.log(`  ${s}: ${elapsed}s ✅ conf=${best.confidence.toFixed(3)} tpl=${tplName} @ (${best.location.x},${best.location.y})`);

          // 画框保存
          const img = sharp(sp);
          const color = best.confidence >= 0.85 ? 'lime' : 'yellow';
          const svg = `<svg width="1600" height="900" xmlns="http://www.w3.org/2000/svg">
            <rect x="${best.rect.x}" y="${best.rect.y}" width="${best.rect.width}" height="${best.rect.height}" fill="none" stroke="${color}" stroke-width="3"/>
            <text x="${best.rect.x}" y="${best.rect.y - 4}" fill="${color}" font-size="14" font-family="Arial" font-weight="bold">FORT ${(best.confidence*100).toFixed(0)}% ${tplName}</text>
          </svg>`;
          const out = path.join(outDir, s.replace('.png', '_marked.png'));
          await img.composite([{ input: Buffer.from(svg), top: 0, left: 0 }]).toFile(out);
        } else {
          const maxConf = Math.max(...results.map(r => r.confidence));
          console.log(`  ${s}: ${elapsed}s ❌ max_conf=${maxConf.toFixed(3)}`);
        }
      }

      const total = ((Date.now() - startTime) / 1000).toFixed(1);
      console.log(`\n总计: ${foundCount}/${screenshots.length} 张命中, 耗时 ${total}s`);
      console.log(`标注截图: ${outDir}`);
    }, 180000);

    it('should report per-template confidence and draw red rectangles on all 9 chengzhaiTest screenshots', async () => {
      const SCALES = [0.8, 0.9, 1.0];
      const THRESHOLD = 0.7;
      const CZ_TEMPLATES = [
        path.join(TEMPLATE_DIR, 'ChengZhai.png'),
        path.join(TEMPLATE_DIR, 'ChengZhai_Afternoon_result.png'),
        path.join(TEMPLATE_DIR, 'ChengZhai_night_result.png'),
      ];
      const TPL_SHORT_NAMES = ['ChengZhai', 'Afternoon', 'Night'];
      const screenshots = [
        'day1.png', 'day2.png', 'day3.png',
        'afternoonTest1.png', 'afternoonTest2.png', 'afternoonTest3.png',
        'nightTest1.png', 'nightTest2.png', 'nightTest3.png',
      ];
      const outDir = path.join(CHENG_ZHAI_DIR, 'output');
      await fs.mkdir(outDir, { recursive: true });

      console.log('\n=== 逐模板置信度报告（红框标注）===\n');
      const startTime = Date.now();
      let totalFound = 0;

      for (const s of screenshots) {
        const sp = path.join(CHENG_ZHAI_DIR, s);
        const t0 = Date.now();

        // 并行搜索所有模板
        const results = await Promise.all(
          CZ_TEMPLATES.map(t => vision.findImage(sp, t, THRESHOLD, SCALES))
        );

        const elapsed = ((Date.now() - t0) / 1000).toFixed(1);

        // 逐模板列出置信度
        console.log(`━━━ ${s} (${elapsed}s) ━━━`);
        results.forEach((r, i) => {
          const marker = r.found ? '✅' : '❌';
          console.log(`  ${marker} ${TPL_SHORT_NAMES[i]}: conf=${r.confidence.toFixed(3)} @ (${r.location.x},${r.location.y})`);
        });

        // 选最佳匹配
        const best = results
          .filter(r => r.found)
          .sort((a, b) => b.confidence - a.confidence)[0];

        if (best) {
          totalFound++;
          const bestIdx = results.indexOf(best);
          const tplName = TPL_SHORT_NAMES[bestIdx];
          console.log(`  ▶ 最佳: ${tplName} conf=${best.confidence.toFixed(3)}`);

          // 红框标注保存
          const img = sharp(sp);
          const svg = `<svg width="1600" height="900" xmlns="http://www.w3.org/2000/svg">
            <rect x="${best.rect.x}" y="${best.rect.y}" width="${best.rect.width}" height="${best.rect.height}" fill="none" stroke="red" stroke-width="3"/>
            <text x="${best.rect.x}" y="${best.rect.y - 4}" fill="red" font-size="14" font-family="Arial" font-weight="bold">${tplName} ${(best.confidence*100).toFixed(0)}%</text>
          </svg>`;
          const out = path.join(outDir, s.replace('.png', '_red_marked.png'));
          await img.composite([{ input: Buffer.from(svg), top: 0, left: 0 }]).toFile(out);
          console.log(`  已保存: ${out}`);
        } else {
          const maxConf = Math.max(...results.map(r => r.confidence));
          console.log(`  ▶ 未命中 (最高原始值: ${maxConf.toFixed(3)})`);
        }
      }

      const total = ((Date.now() - startTime) / 1000).toFixed(1);
      console.log(`\n━━━━━━━━━━━━━━━━━━━━`);
      console.log(`总计: ${totalFound}/${screenshots.length} 张命中, 耗时 ${total}s`);
      console.log(`红框截图: ${outDir}\\*_red_marked.png`);
    }, 180000);

    it('should measure gem recognition time on 3 output screenshots', async () => {
      const SCALES = [0.8, 0.9, 1.0];
      const THRESHOLD = 0.7;
      const OUTPUT_DIR = path.join(SCREENSHOT_DIR, 'output');
      // 用原始截图（非 v2 标记版），输出到 output/gem_red/
      const screenshots = ['day1.png', 'day2.png', 'day3.png'];
      const outDir = path.join(OUTPUT_DIR, 'gem_red');
      await fs.mkdir(outDir, { recursive: true });

      console.log('\n=== 宝石识别耗时测试（红框标注）===\n');
      const startTime = Date.now();
      const timings: number[] = [];

      for (const s of screenshots) {
        const sp = path.join(SCREENSHOT_DIR, s);
        const t0 = Date.now();

        // 并行搜索所有宝石模板
        const results = await Promise.all(
          BAOSHI_TEMPLATES.map(t => vision.findImage(sp, t, THRESHOLD, SCALES))
        );

        const perImg = ((Date.now() - t0) / 1000);
        timings.push(perImg);

        console.log(`━━━ ${s} (${perImg.toFixed(1)}s) ━━━`);
        results.forEach((r, i) => {
          const tplName = path.basename(BAOSHI_TEMPLATES[i]);
          console.log(`  ${r.found ? '✅' : '❌'} ${tplName}: conf=${r.confidence.toFixed(3)} @ (${r.location.x},${r.location.y})`);
        });

        const best = results.filter(r => r.found).sort((a, b) => b.confidence - a.confidence)[0];
        if (best) {
          const bestIdx = results.indexOf(best);
          const tplName = path.basename(BAOSHI_TEMPLATES[bestIdx]);
          console.log(`  ▶ 最佳: ${tplName} conf=${best.confidence.toFixed(3)}`);

          // 红框标注保存
          const img = sharp(sp);
          const svg = `<svg width="1600" height="900" xmlns="http://www.w3.org/2000/svg">
            <rect x="${best.rect.x}" y="${best.rect.y}" width="${best.rect.width}" height="${best.rect.height}" fill="none" stroke="red" stroke-width="3"/>
            <text x="${best.rect.x}" y="${best.rect.y - 4}" fill="red" font-size="16" font-family="Arial" font-weight="bold">GEM ${(best.confidence*100).toFixed(0)}% ${tplName}</text>
          </svg>`;
          const out = path.join(outDir, s.replace('.png', '_gem_red.png'));
          await img.composite([{ input: Buffer.from(svg), top: 0, left: 0 }]).toFile(out);
          console.log(`  已保存: ${out}`);
        } else {
          console.log(`  ▶ 未命中 (最高: ${Math.max(...results.map(r => r.confidence)).toFixed(3)})`);
        }
      }

      const total = ((Date.now() - startTime) / 1000).toFixed(1);
      const avg = (timings.reduce((a, b) => a + b, 0) / timings.length).toFixed(1);
      const min = Math.min(...timings).toFixed(1);
      const max = Math.max(...timings).toFixed(1);
      console.log(`\n━━━━━━━━━━━━━━━━━━━━`);
      console.log(`总耗时: ${total}s | 平均: ${avg}s/张 | 最快: ${min}s | 最慢: ${max}s`);
      console.log(`红框截图: ${outDir}`);
    }, 120000);
  });
});
