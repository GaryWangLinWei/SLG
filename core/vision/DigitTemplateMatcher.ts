import sharp from 'sharp';
import * as path from 'path';
import * as fs from 'fs/promises';

interface Template {
  digit: number;
  width: number;
  height: number;
  data: Uint8Array;
  mean: number;
  std: number;
}

interface Match {
  digit: number;
  x: number;
  score: number;
}

/**
 * 基于像素模板匹配的数字识别器
 * 专门针对万国觉醒等游戏中半透明叠加的数字，准确率远高于 Tesseract OCR
 */
export class DigitTemplateMatcher {
  private templates: Template[] = [];
  private initialized: boolean = false;

  constructor(private templatesDir: string) {}

  /**
   * 加载 0-9 数字模板
   * 模板文件名: digit_0.png, digit_1.png, ..., digit_9.png
   */
  async init(): Promise<void> {
    if (this.initialized) return;

    for (let digit = 0; digit <= 9; digit++) {
      const templatePath = path.join(this.templatesDir, `digit_${digit}.png`);
      try {
        const img = sharp(templatePath).grayscale();
        const metadata = await img.metadata();
        const data = await img.raw().toBuffer();

        const width = metadata.width || 0;
        const height = metadata.height || 0;
        const uint8Data = new Uint8Array(data);
        const mean = this.calcMean(uint8Data);
        const std = this.calcStd(uint8Data, mean);

        this.templates.push({ digit, width, height, data: uint8Data, mean, std });
      } catch (e) {
        // console.debug(`[DigitMatcher] 未找到数字 ${digit} 的模板`);
      }
    }

    this.initialized = true;
  }

  /**
   * 识别图像中的数字串
   * @param imagePath 输入图像路径
   * @param threshold 匹配阈值（0-1，越大越严格）
   * @returns 识别到的数字字符串
   */
  async recognize(imagePath: string, threshold: number = 0.7): Promise<string> {
    if (!this.initialized) await this.init();
    if (this.templates.length === 0) return '';

    // 预处理输入图像：灰度化
    const inputImg = sharp(imagePath).grayscale();
    const inputData = new Uint8Array(await inputImg.raw().toBuffer());
    const inputMeta = await inputImg.metadata();
    const inputW = inputMeta.width || 0;
    const inputH = inputMeta.height || 0;

    // 对每个模板做全图滑动匹配（同时试反色和正常色）
    const allMatches: Match[] = [];

    for (const template of this.templates) {
      const matchesInvert = this.matchTemplate(inputData, inputW, inputH, template, threshold, true);
      const matchesNormal = this.matchTemplate(inputData, inputW, inputH, template, threshold, false);

      allMatches.push(...matchesInvert, ...matchesNormal);
    }

    // NMS 去重 + 按 x 坐标排序
    const digits = this.nmsAndSort(allMatches);
    const result = digits.map(d => d.digit).join('');

    return result;
  }

  /**
   * 单模板滑动匹配
   */
  private matchTemplate(
    inputData: Uint8Array,
    inputW: number,
    inputH: number,
    template: Template,
    threshold: number,
    invert: boolean
  ): Match[] {
    const matches: Match[] = [];
    const templateW = template.width;
    const templateH = template.height;

    if (templateW > inputW || templateH > inputH) {
      return matches;
    }

    for (let y = 0; y <= inputH - templateH; y++) {
      for (let x = 0; x <= inputW - templateW; x++) {
        const score = this.calcCorrelation(inputData, inputW, x, y, template, invert);
        if (score >= threshold) {
          matches.push({ digit: template.digit, x, score });
        }
      }
    }

    return matches;
  }

  /**
   * 计算归一化互相关系数
   */
  private calcCorrelation(
    inputData: Uint8Array,
    inputW: number,
    startX: number,
    startY: number,
    template: Template,
    invert: boolean
  ): number {
    const templateW = template.width;
    const templateH = template.height;
    const templateData = template.data;
    const n = templateW * templateH;

    let windowSum = 0;
    for (let y = 0; y < templateH; y++) {
      for (let x = 0; x < templateW; x++) {
        const inputIdx = (startY + y) * inputW + (startX + x);
        windowSum += inputData[inputIdx];
      }
    }
    const windowMean = windowSum / n;

    let numerator = 0;
    let windowVar = 0;
    const templateMean = invert ? (255 - template.mean) : template.mean;

    for (let y = 0; y < templateH; y++) {
      for (let x = 0; x < templateW; x++) {
        const inputIdx = (startY + y) * inputW + (startX + x);
        const templateIdx = y * templateW + x;

        const inputDiff = inputData[inputIdx] - windowMean;
        const templatePixel = invert ? (255 - templateData[templateIdx]) : templateData[templateIdx];
        const templateDiff = templatePixel - templateMean;

        numerator += inputDiff * templateDiff;
        windowVar += inputDiff * inputDiff;
      }
    }

    const windowStd = Math.sqrt(windowVar / n);
    if (windowStd === 0 || template.std === 0) return 0;

    const corr = (numerator / n) / (windowStd * template.std);
    return (corr + 1) / 2;
  }

  /**
   * NMS 非极大值抑制 + 按 x 坐标排序
   * 坐标数字挨得极近，采用按列聚类策略：同一 x 范围内只留最高分
   */
  private nmsAndSort(matches: Match[]): Match[] {
    if (matches.length === 0) return [];

    const minScore = 0.82;
    const clusterThreshold = 5;  // 5 像素内算同一列

    // 过滤低分
    const validMatches = matches.filter(m => m.score >= minScore);

    // 按 x 升序排列
    validMatches.sort((a, b) => a.x - b.x);

    // 按 x 坐标聚类，每类只留最高分
    const clusters: Match[][] = [];
    for (const m of validMatches) {
      let added = false;
      for (const cluster of clusters) {
        if (Math.abs(m.x - cluster[0].x) < clusterThreshold) {
          cluster.push(m);
          added = true;
          break;
        }
      }
      if (!added) clusters.push([m]);
    }

    // 每类取最高分
    const result = clusters.map(cluster =>
      cluster.reduce((best, m) => m.score > best.score ? m : best, cluster[0])
    );

    // 按 x 从左到右排序
    result.sort((a, b) => a.x - b.x);

    return result;
  }

  private calcMean(data: Uint8Array): number {
    let sum = 0;
    for (let i = 0; i < data.length; i++) {
      sum += data[i];
    }
    return sum / data.length;
  }

  private calcStd(data: Uint8Array, mean: number): number {
    let sum = 0;
    for (let i = 0; i < data.length; i++) {
      const diff = data[i] - mean;
      sum += diff * diff;
    }
    return Math.sqrt(sum / data.length);
  }

  /**
   * 是否有可用模板
   */
  hasTemplates(): boolean {
    return this.templates.length > 0;
  }
}

// 全局单例（按模板目录缓存）
const matcherInstances: Map<string, DigitTemplateMatcher> = new Map();

export async function getDigitMatcher(templatesDir: string): Promise<DigitTemplateMatcher> {
  if (!matcherInstances.has(templatesDir)) {
    const matcher = new DigitTemplateMatcher(templatesDir);
    await matcher.init();
    matcherInstances.set(templatesDir, matcher);
  }
  return matcherInstances.get(templatesDir)!;
}
