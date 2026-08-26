import sharp from 'sharp';
import * as fs from 'fs/promises';
import { existsSync } from 'fs';
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
   * 宝石数量：模板匹配路径必须读出完整的千位分隔数字，
   * 读数不完整时返回空串（由 readGemCount action 转成 null），不得返回截断值。
   */
  describe('readGemCount', () => {
    const gemDir = path.join(__dirname, '../../temp/debug/gem_count');

    it('reads the full number across the thousands separator', async () => {
      const p = path.join(gemDir, '106_1785792729930.png');
      if (!existsSync(p)) return; // skip 如果本地没有截图
      expect(await ocrService.readGemCount(p)).toBe('43106');
    }, 60000);

    it('returns empty string when the reading is incomplete', async () => {
      // 真值 25,275，模板尺度不匹配漏掉末位 → 不得返回 "2527"
      const p = path.join(gemDir, '27_1784937467944.png');
      if (!existsSync(p)) return;
      expect(await ocrService.readGemCount(p)).toBe('');
    }, 60000);
  });
});
