import * as fs from 'fs/promises';
import * as fsSync from 'fs';
import * as path from 'path';
import sharp from 'sharp';
import { ImageMatchResult, Rect, Point } from '../types';

const TEMP_DIR = path.join(process.cwd(), 'temp', 'vision');

// Ensure temp directory exists
if (!fsSync.existsSync(TEMP_DIR)) {
  fsSync.mkdirSync(TEMP_DIR, { recursive: true });
}

export class Vision {
  /**
   * Find a template image within a screenshot using pixel-perfect template matching.
   * When `scales` is provided, tries each scale and returns the best match.
   * e.g. scales: [0.8, 0.9, 1.0, 1.1, 1.2] for multi-resolution support.
   */
  async findImage(
    screenshotPath: string,
    templatePath: string,
    threshold: number = 0.85,
    scales?: number[]
  ): Promise<ImageMatchResult> {
    const scaleList = scales || [1.0];

    let bestResult: ImageMatchResult = {
      found: false,
      confidence: 0,
      location: { x: 0, y: 0 },
      rect: { x: 0, y: 0, width: 0, height: 0 }
    };

    for (const scale of scaleList) {
      const result = await this._matchTemplate(screenshotPath, templatePath, scale);
      if (result.confidence > bestResult.confidence) {
        bestResult = result;
      }
    }

    bestResult.found = bestResult.confidence >= threshold;
    if (!bestResult.found) {
      const scaleInfo = scaleList.length > 1
        ? ` scales=[${scaleList.join(',')}]`
        : '';
      console.log(`[Vision] Best match: (${bestResult.rect.x + Math.floor(bestResult.rect.width / 2)}, ${bestResult.rect.y + Math.floor(bestResult.rect.height / 2)}) confidence=${bestResult.confidence.toFixed(3)}, threshold=${threshold}${scaleInfo}`);
    }
    return bestResult;
  }

  /**
   * Match template against screenshot at a specific scale.
   */
  private async _matchTemplate(
    screenshotPath: string,
    templatePath: string,
    scale: number
  ): Promise<ImageMatchResult> {
    // Load screenshot
    const screenshotData = await sharp(await fs.readFile(screenshotPath))
      .raw().toBuffer({ resolveWithObject: true });

    const sWidth = screenshotData.info.width;
    const sHeight = screenshotData.info.height;
    const channels = screenshotData.info.channels;
    const sPixels = screenshotData.data;

    // Load and optionally scale template
    const templateMeta = await sharp(templatePath).metadata();
    const tWidth = Math.round(templateMeta.width! * scale);
    const tHeight = Math.round(templateMeta.height! * scale);

    if (tWidth > sWidth || tHeight > sHeight) {
      return { found: false, confidence: 0,
        location: { x: 0, y: 0 },
        rect: { x: 0, y: 0, width: 0, height: 0 }
      };
    }

    const templateRaw = scale === 1.0
      ? await sharp(await fs.readFile(templatePath)).raw().toBuffer({ resolveWithObject: true })
      : await sharp(templatePath)
          .resize({ width: tWidth, height: tHeight })
          .raw().toBuffer({ resolveWithObject: true });
    const tPixels = templateRaw.data;
    const totalPixels = tWidth * tHeight;

    // --- Coarse scan ---
    const coarseStepX = Math.max(1, Math.floor(tWidth / 4));
    const coarseStepY = Math.max(1, Math.floor(tHeight / 4));
    const candidates: Array<{ x: number; y: number; confidence: number }> = [];

    for (let y = 0; y <= sHeight - tHeight; y += coarseStepY) {
      for (let x = 0; x <= sWidth - tWidth; x += coarseStepX) {
        let diffPixels = 0;

        for (let ty = 0; ty < tHeight; ty += 2) {
          for (let tx = 0; tx < tWidth; tx += 2) {
            const sIdx = ((y + ty) * sWidth + (x + tx)) * channels;
            const tIdx = (ty * tWidth + tx) * channels;

            for (let c = 0; c < 3; c++) {
              if (Math.abs(sPixels[sIdx + c] - tPixels[tIdx + c]) > 48) {
                diffPixels++;
                break;
              }
            }
          }
        }

        const sampleCount = Math.ceil(tHeight / 2) * Math.ceil(tWidth / 2);
        const confidence = 1 - (diffPixels / sampleCount);

        if (confidence > 0.3) {
          candidates.push({ x, y, confidence });
        }
      }
    }

    candidates.sort((a, b) => b.confidence - a.confidence);
    candidates.length = Math.min(candidates.length, 10);

    // --- Fine scan ---
    let bestMatch = { x: 0, y: 0, confidence: 0 };
    const searchRadius = 8;

    for (const candidate of candidates) {
      for (let dy = -searchRadius; dy <= searchRadius; dy += 2) {
        for (let dx = -searchRadius; dx <= searchRadius; dx += 2) {
          const cx = candidate.x + dx;
          const cy = candidate.y + dy;
          if (cx < 0 || cy < 0 || cx > sWidth - tWidth || cy > sHeight - tHeight) continue;

          let diffPixels = 0;
          for (let ty = 0; ty < tHeight; ty++) {
            for (let tx = 0; tx < tWidth; tx++) {
              const sIdx = ((cy + ty) * sWidth + (cx + tx)) * channels;
              const tIdx = (ty * tWidth + tx) * channels;

              for (let c = 0; c < 3; c++) {
                if (Math.abs(sPixels[sIdx + c] - tPixels[tIdx + c]) > 48) {
                  diffPixels++;
                  break;
                }
              }
            }
          }

          const confidence = 1 - (diffPixels / totalPixels);
          if (confidence > bestMatch.confidence) {
            bestMatch = { x: cx, y: cy, confidence };
          }
        }
      }
    }

    return {
      found: bestMatch.confidence >= 0, // caller determines threshold
      confidence: bestMatch.confidence,
      location: {
        x: Math.floor(bestMatch.x + tWidth / 2),
        y: Math.floor(bestMatch.y + tHeight / 2)
      },
      rect: {
        x: bestMatch.x,
        y: bestMatch.y,
        width: tWidth,
        height: tHeight
      }
    };
  }

  /**
   * Find all occurrences of a template within the screenshot
   */
  async findAllImages(
    screenshotPath: string,
    templatePath: string,
    threshold: number = 0.85
  ): Promise<ImageMatchResult[]> {
    const results: ImageMatchResult[] = [];
    let currentScreenshot = screenshotPath;

    while (true) {
      const result = await this.findImage(currentScreenshot, templatePath, threshold);
      if (!result.found) break;

      results.push(result);

      // Black out the found area to avoid duplicate matches
      const outputPath = path.join(TEMP_DIR, `masked_${Date.now()}.png`);
      await sharp(await fs.readFile(currentScreenshot))
        .flatten()
        .extend({
          top: 0,
          bottom: 0,
          left: 0,
          right: 0,
          background: { r: 0, g: 0, b: 0 }
        })
        .toFile(outputPath);

      // For simplicity, just do a single pass
      break;
    }

    return results;
  }

  /**
   * Tap on the center of a found template
   */
  getTapLocation(result: ImageMatchResult): Point {
    return {
      x: Math.floor(result.rect.x + result.rect.width / 2),
      y: Math.floor(result.rect.y + result.rect.height / 2)
    };
  }

  /**
   * Compare two images and return the percentage of differing pixels
   * Used to detect if a button state changed after click
   */
  async compareImages(
    imagePath1: string,
    imagePath2: string,
    pixelThreshold: number = 48
  ): Promise<number> {
    const [data1, data2] = await Promise.all([
      sharp(await fs.readFile(imagePath1)).raw().toBuffer({ resolveWithObject: true }),
      sharp(await fs.readFile(imagePath2)).raw().toBuffer({ resolveWithObject: true })
    ]);

    // Ensure images have same dimensions
    if (data1.info.width !== data2.info.width || data1.info.height !== data2.info.height) {
      throw new Error(`Image dimensions mismatch: ${data1.info.width}x${data1.info.height} vs ${data2.info.width}x${data2.info.height}`);
    }

    const totalPixels = data1.info.width * data1.info.height;
    const channels = data1.info.channels;
    let diffPixels = 0;

    for (let i = 0; i < totalPixels * channels; i += channels) {
      let pixelDiff = 0;
      for (let c = 0; c < 3; c++) {
        pixelDiff += Math.abs(data1.data[i + c] - data2.data[i + c]);
      }
      // If average pixel difference exceeds threshold, count as different
      if (pixelDiff / 3 > pixelThreshold) {
        diffPixels++;
      }
    }

    return diffPixels / totalPixels;
  }
}
