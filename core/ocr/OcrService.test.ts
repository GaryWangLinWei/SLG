import sharp from 'sharp';
import * as fs from 'fs/promises';
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
});
