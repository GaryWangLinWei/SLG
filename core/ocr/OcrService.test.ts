import sharp from 'sharp';
import * as fs from 'fs/promises';
import { existsSync, readdirSync } from 'fs';
import * as os from 'os';
import * as path from 'path';
import { ocrService } from './OcrService';

describe('OcrService', () => {
  afterAll(async () => {
    await ocrService.destroy();
  });

  it('should create worker and return empty string for blank image', async () => {
    const tmpPath = path.join(os.tmpdir(), 'ocr-blank-test.png');
    await sharp({
      create: { width: 100, height: 30, channels: 3, background: { r: 255, g: 255, b: 255 } }
    }).png().toFile(tmpPath);

    const text = await ocrService.readText(tmpPath);
    await fs.unlink(tmpPath).catch(() => {});

    expect(typeof text).toBe('string');
    expect(text.length).toBeLessThan(5);
  }, 60000);

  it('should be singleton (same instance)', () => {
    const { ocrService: same } = require('./OcrService');
    expect(same).toBe(ocrService);
  });

  /**
   * 宝石数量：模板匹配（gapChain 关闭）+ Tesseract 交叉校验，两路一致才采纳。
   * 用仓库内的 digits_gem 模板合成截图，不依赖 temp/debug 下的真机截图。
   */
  describe('readGemCount', () => {
    const templatesDir = path.join(__dirname, '../../plugins/rok/templates/digits_gem');
    const gemDir = path.join(__dirname, '../../temp/debug/gem_count');

    it('returns the full number when both engines agree', async () => {
      // 34,131，跨逗号间距 22px —— 修复前模板路径会截成 "131"
      const p = path.join(os.tmpdir(), 'gem-ocr-syn.png');
      await sharp({
        create: { width: 80, height: 37, channels: 3, background: { r: 12, g: 14, b: 20 } },
      })
        .composite([3, 4, 1, 3, 1].map((d, i) => ({
          input: path.join(templatesDir, `digit_${d}.png`),
          left: [3, 16, 38, 50, 63][i],
          top: 5,
        })))
        .png()
        .toFile(p);

      const got = await ocrService.readGemCount(p);
      await fs.unlink(p).catch(() => {});
      expect(got).toBe('34131');
    }, 60000);

    it('returns empty string when the two engines disagree', async () => {
      const blank = path.join(os.tmpdir(), 'gem-disagree-test.png');
      await sharp({
        create: { width: 80, height: 37, channels: 3, background: { r: 0, g: 0, b: 0 } },
      }).png().toFile(blank);

      // 纯黑图：模板匹配读不到东西 → 两路无法一致 → 丢弃，不得返回任何数字
      const got = await ocrService.readGemCount(blank);
      await fs.unlink(blank).catch(() => {});
      expect(got).toBe('');
    }, 60000);

    it('real screenshots (if present) pass cross-validation', async () => {
      if (!existsSync(gemDir)) return;
      const files = readdirSync(gemDir).filter(f => f.endsWith('.png'));
      if (files.length === 0) return; // 截图已被清理，跳过

      const failures: string[] = [];
      for (const f of files) {
        const got = await ocrService.readGemCount(path.join(gemDir, f));
        if (!/^\d{4,6}$/.test(got)) failures.push(`${f}: got "${got}"`);
      }
      expect(failures).toEqual([]);
    }, 180000);
  });
});
