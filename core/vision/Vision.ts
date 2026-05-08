import * as fs from 'fs/promises';
import { ImageMatchResult, Rect, Point } from '../types';

/**
 * Vision module for template matching image recognition
 *
 * NOTE: This is a stub implementation. The actual OpenCV-based template matching
 * requires native dependencies that are difficult to install on modern Node.js/Windows.
 *
 * To enable full functionality:
 * 1. Install @u4/opencv4nodejs (prebuilt binaries)
 * 2. Or implement using pure JS libraries like sharp + pixelmatch
 */
export class Vision {
  /**
   * Find a template image within a screenshot
   * @param screenshotPath Path to the screenshot image
   * @param templatePath Path to the template image to find
   * @param threshold Confidence threshold (0.0 to 1.0, default 0.8)
   * @returns Match result with found status, confidence, and location
   */
  async findImage(
    screenshotPath: string,
    templatePath: string,
    threshold: number = 0.8
  ): Promise<ImageMatchResult> {
    // Verify files exist
    try {
      await fs.access(screenshotPath);
      await fs.access(templatePath);
    } catch (error) {
      throw new Error(`Image file not found: ${(error as Error).message}`);
    }

    // Stub implementation: always return not found
    // TODO: Implement actual template matching using @u4/opencv4nodejs or sharp/pixelmatch
    const location: Point = { x: 0, y: 0 };
    const rect: Rect = { x: 0, y: 0, width: 0, height: 0 };

    return {
      found: false,
      confidence: 0,
      location,
      rect
    };
  }
}
