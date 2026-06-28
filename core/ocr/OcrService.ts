import Tesseract from 'tesseract.js';
import { getTraineddataDir, getTemplatesDir } from '../resourcePath';
import sharp from 'sharp';
import * as fs from 'fs/promises';
import * as path from 'path';
import { getDigitMatcher } from '../vision/DigitTemplateMatcher';

type OcrWorker = Tesseract.Worker;

const LANG_PATH = getTraineddataDir();

class OcrService {
  private worker: OcrWorker | null = null;
  private workerChs: OcrWorker | null = null;

  private async getWorker(): Promise<OcrWorker> {
    if (!this.worker) {
      this.worker = await Tesseract.createWorker('eng', 1, { langPath: LANG_PATH });
    }
    return this.worker;
  }

  private async getChineseWorker(): Promise<OcrWorker> {
    if (!this.workerChs) {
      this.workerChs = await Tesseract.createWorker('chi_sim', 1, { langPath: LANG_PATH });
    }
    return this.workerChs;
  }

  /**
   * 识别图像中的文本
   */
  async readText(imagePath: string): Promise<string> {
    const worker = await this.getWorker();
    const { data } = await worker.recognize(imagePath);
    return data.text.trim();
  }

  /**
   * 识别队伍数（格式如 "2/4"）
   */
  async readTeamCount(imagePath: string): Promise<string> {
    const worker = await this.getWorker();
    await worker.setParameters({
      tessedit_char_whitelist: '0123456789/',
    });
    const { data } = await worker.recognize(imagePath);
    await worker.setParameters({ tessedit_char_whitelist: '' });
    return data.text.trim();
  }

  /**
   * 识别距离数字（如 "36" 从 "36公里"）
   * 优先使用模板匹配（准确率更高），没有模板时 fallback 到 Tesseract
   */
  async readDistance(imagePath: string): Promise<string> {
    const digitMatcher = await getDigitMatcher(path.join(getTemplatesDir(), 'digits_distance'));
    if (digitMatcher.hasTemplates()) {
      const result = await digitMatcher.recognize(imagePath, 0.82);
      console.log(`[DigitMatcher] 距离识别结果: "${result}"`);
      if (result) return result;
    }

    const worker = await this.getWorker();
    await worker.setParameters({
      tessedit_char_whitelist: '0123456789',
    });
    const { data } = await worker.recognize(imagePath);
    await worker.setParameters({ tessedit_char_whitelist: '' });
    return data.text.trim();
  }

  /**
   * 识别队列倒计时（格式如 "01:23:45" 或 "1h 23m"）
   */
  async readCountdown(imagePath: string): Promise<string> {
    const worker = await this.getWorker();
    await worker.setParameters({
      tessedit_char_whitelist: '0123456789:hHmM',
    });
    const { data } = await worker.recognize(imagePath);
    await worker.setParameters({ tessedit_char_whitelist: '' });
    return data.text.trim();
  }

  /**
   * 识别宝石采集坐标（使用 Tesseract OCR）
   */
  async readCoordinates(imagePath: string): Promise<string> {
    const worker = await this.getWorker();
    await worker.setParameters({
      tessedit_char_whitelist: '0123456789',
    });
    const { data } = await worker.recognize(imagePath);
    await worker.setParameters({ tessedit_char_whitelist: '' });
    const result = data.text.trim();
    console.log(`[Tesseract] 宝石坐标识别结果: "${result}"`);
    return result;
  }

  /**
   * 识别山洞坐标（使用 Tesseract）
   */
  async readCaveCoordinates(imagePath: string): Promise<string> {
    const worker = await this.getWorker();
    await worker.setParameters({
      tessedit_char_whitelist: '0123456789',
    });
    const { data } = await worker.recognize(imagePath);
    await worker.setParameters({ tessedit_char_whitelist: '' });
    const result = data.text.trim();
    console.log(`[Tesseract] 山洞坐标识别结果: "${result}"`);
    return result;
  }

  /**
   * 识别图像中的数字
   */
  async readDigits(imagePath: string): Promise<string> {
    const worker = await this.getWorker();
    await worker.setParameters({
      tessedit_char_whitelist: '0123456789',
    });
    const { data } = await worker.recognize(imagePath);
    await worker.setParameters({ tessedit_char_whitelist: '' });
    return data.text.trim();
  }

  /**
   * 识别宝石数量（格式如 "5,562"，带千位分隔符）
   * 优先使用模板匹配（准确率更高），没有模板时 fallback 到 Tesseract
   */
  async readGemCount(imagePath: string): Promise<string> {
    const digitMatcher = await getDigitMatcher(path.join(getTemplatesDir(), 'digits_gem'));
    if (digitMatcher.hasTemplates()) {
      const result = await digitMatcher.recognize(imagePath, 0.75);
      console.log(`[DigitMatcher] 宝石数量识别结果: "${result}"`);
      if (result) return result;
    }

    const worker = await this.getWorker();
    await worker.setParameters({
      tessedit_char_whitelist: '0123456789,',
    });
    const { data } = await worker.recognize(imagePath);
    await worker.setParameters({ tessedit_char_whitelist: '' });
    return data.text.trim();
  }

  /**
   * 识别图像中的中文文本
   */
  async readChineseText(imagePath: string): Promise<string> {
    const worker = await this.getChineseWorker();
    const { data } = await worker.recognize(imagePath);
    return data.text.trim();
  }

  async destroy(): Promise<void> {
    if (this.worker) {
      await this.worker.terminate();
      this.worker = null;
    }
    if (this.workerChs) {
      await this.workerChs.terminate();
      this.workerChs = null;
    }
  }
}

export const ocrService = new OcrService();
