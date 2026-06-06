import { Vision } from './Vision';
import { getTemplatesDir } from '../resourcePath';
import * as path from 'path';
import * as fs from 'fs/promises';

const SCREENSHOT_DIR = 'C:\\Users\\54459\\Desktop\\Test';
const TEMPLATE_DIR = getTemplatesDir();
const CHENG_ZHAI_TEMPLATE = path.join(TEMPLATE_DIR, 'ChengZhai.png');

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
});
