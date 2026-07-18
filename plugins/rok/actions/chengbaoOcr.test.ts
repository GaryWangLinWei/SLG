import * as fs from 'fs/promises';
import * as path from 'path';
import { ocrService } from '../../../core/ocr/OcrService';

const DIR = 'D:/SLG/temp/debug/chengbao_ocr';

describe('chengbao_ocr — 复检截图数字', () => {
  let files: string[] = [];

  beforeAll(async () => {
    const entries = await fs.readdir(DIR).catch(() => [] as string[]);
    files = entries.filter(f => f.endsWith('.png')).map(f => path.join(DIR, f));
  });

  afterAll(async () => {});

  it('目录应存在且非空', () => {
    expect(files.length).toBeGreaterThan(0);
  });

  it('逐张 OCR 数字并对比文件名标注', async () => {
    for (const full of files) {
      const name = path.basename(full);
      // 文件名格式：chengbao_<ts>_d<数字或x>.png
      const m = name.match(/_d([0-9x]+)\.png$/);
      const labeled = m ? m[1] : '?';
      const digits = await ocrService.readDistance(full);
      const match = labeled === 'x' ? digits === '' : digits === labeled;
      console.log(`  ${match ? '✅' : '⚠️'} ${name}  文件名=${labeled}  OCR="${digits}"`);
    }
  }, 120_000);
});
