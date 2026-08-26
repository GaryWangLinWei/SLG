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

export interface RecognizeOptions {
  /**
   * 是否启用「锚点 + maxDigitGap 贪婪连接」裁剪（默认 true）。
   *
   * - `true`：从最高分簇向两侧连接，间距超过 maxDigitGap 即停。用于画面里可能混入
   *   非数字内容的区域，例如距离 "36公里" 需要排掉「公」「里」的误匹配。
   * - `false`：按 x 升序取全部簇，不做间距裁剪。用于紧裁剪、区域内只有数字的场景
   *   （如宝石数量）——千位分隔符会让相邻数字间距达到 ~22px，贪婪连接会误判为无关内容而断链。
   */
  gapChain?: boolean;
}

export interface DigitRecognition {
  /** 识别出的数字串 */
  text: string;
  /** 命中的数字个数 */
  digitCount: number;
  /**
   * 列投影得到的字形组数，**包含**逗号等非数字字形。
   * 与 `expectedGlyphGroups(digitCount)` 比对可判断读数是否完整。
   */
  glyphGroups: number;
}

/**
 * 千位分隔符格式下，`digitCount` 位数字对应的字形组数。
 *
 * 5 位 → 6 组（5 个数字 + 1 个逗号）；7 位 → 9 组（7 个数字 + 2 个逗号）。
 * 用于校验模板匹配有没有漏字：组数对不上说明画面里的字形比命中的数字多，读数不完整。
 */
export function expectedGlyphGroups(digitCount: number): number {
  if (digitCount <= 0) return 0;
  return digitCount + Math.floor((digitCount - 1) / 3);
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
  async recognize(
    imagePath: string,
    threshold: number = 0.7,
    options: RecognizeOptions = {}
  ): Promise<string> {
    return (await this.recognizeDetailed(imagePath, threshold, options)).text;
  }

  /**
   * 与 `recognize()` 相同的识别流程，额外返回字形组数供调用方校验读数完整性。
   */
  async recognizeDetailed(
    imagePath: string,
    threshold: number = 0.7,
    options: RecognizeOptions = {}
  ): Promise<DigitRecognition> {
    if (!this.initialized) await this.init();
    if (this.templates.length === 0) return { text: '', digitCount: 0, glyphGroups: 0 };

    // 预处理输入图像：灰度化（grayscale() 输出单通道，即使原图带 alpha）
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
    const digits = this.nmsAndSort(allMatches, options.gapChain !== false);

    return {
      text: digits.map(d => d.digit).join(''),
      digitCount: digits.length,
      glyphGroups: this.countGlyphGroups(inputData, inputW, inputH),
    };
  }

  /**
   * 列投影统计字形组数：一列里亮像素达到 MIN_PIXELS 视为有内容，
   * 连续有内容的列合成一组。逗号、被漏识别的数字都会各自成组。
   */
  private countGlyphGroups(inputData: Uint8Array, inputW: number, inputH: number): number {
    const MIN_LUM = 150;    // 笔画亮度阈值（游戏内数字为白字）
    const MIN_PIXELS = 2;   // 滤掉截图边缘的单像素噪点

    let groups = 0;
    let inGroup = false;

    for (let x = 0; x < inputW; x++) {
      let lit = 0;
      for (let y = 0; y < inputH; y++) {
        if (inputData[y * inputW + x] > MIN_LUM) lit++;
      }
      const filled = lit >= MIN_PIXELS;
      if (filled && !inGroup) groups++;
      inGroup = filled;
    }

    return groups;
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
   * 坐标数字挨得极近，采用按列聚类策略：同一 x 范围内只留最高分。
   *
   * `gapChain` 为 true 时，再从"最高分数字"（锚点）向左右按间距 ≤ maxDigitGap 贪婪连接，
   * 排除距离远的假匹配（如 "公里" 里被误识别成数字的部件）。
   * 为 false 时跳过该裁剪，直接返回全部簇 —— 紧裁剪区域内只有数字，
   * 且千位分隔符会造成 ~22px 间距，贪婪连接会误判断链。
   */
  private nmsAndSort(matches: Match[], gapChain: boolean = true): Match[] {
    if (matches.length === 0) return [];

    const minScore = 0.75;
    const clusterThreshold = 8;   // 8 像素内算同一列（一个字符宽 ~13-15px，字内假匹配需吸收）
    const maxDigitGap = 20;       // 相邻数字最大 x 间距（超出视为无关内容）
    const scoreRatio = 0.85;      // 相邻数字分数不低于锚点 * 该比例，否则视为"公"/"里"等假匹配

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

    // 每类取最高分，按 x 排序
    const best = clusters.map(cluster =>
      cluster.reduce((b, m) => m.score > b.score ? m : b, cluster[0])
    );
    best.sort((a, b) => a.x - b.x);

    if (best.length === 0) return [];
    if (!gapChain) return best;

    // 找到锚点：分数最高的簇
    let anchorIdx = 0;
    for (let i = 1; i < best.length; i++) {
      if (best[i].score > best[anchorIdx].score) anchorIdx = i;
    }

    // 从锚点向右延伸
    const kept: Match[] = [best[anchorIdx]];
    const minAdjacentScore = best[anchorIdx].score * scoreRatio;
    for (let i = anchorIdx + 1; i < best.length; i++) {
      if (best[i].x - kept[kept.length - 1].x <= maxDigitGap && best[i].score >= minAdjacentScore) kept.push(best[i]);
      else break;
    }
    // 从锚点向左延伸
    for (let i = anchorIdx - 1; i >= 0; i--) {
      if (kept[0].x - best[i].x <= maxDigitGap && best[i].score >= minAdjacentScore) kept.unshift(best[i]);
      else break;
    }

    return kept;
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
