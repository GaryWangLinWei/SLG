import * as ort from 'onnxruntime-node';
import sharp from 'sharp';
import * as fs from 'fs/promises';
import { postProcess, Detection } from './yoloPostProcess';

export { Detection };

export class YoloDetector {
  private session: ort.InferenceSession | null = null;
  private readonly modelSize: number = 640;

  private constructor(private modelPath: string) {}

  /**
   * Factory：加载 ONNX 模型并预热。
   */
  static async create(modelPath: string): Promise<YoloDetector> {
    const detector = new YoloDetector(modelPath);
    await detector.load();
    return detector;
  }

  private async load(): Promise<void> {
    this.session = await ort.InferenceSession.create(this.modelPath, {
      executionProviders: ['cpu'],
    });

    // 预热：跑一次空推理让 ONNX 初始化内部 buffer
    const dummyInput = new Float32Array(3 * this.modelSize * this.modelSize);
    const tensor = new ort.Tensor('float32', dummyInput, [1, 3, this.modelSize, this.modelSize]);
    const feeds: Record<string, ort.Tensor> = {};
    const inputName = this.session.inputNames[0];
    feeds[inputName] = tensor;
    await this.session.run(feeds);
  }

  /**
   * Letterbox resize：保持宽高比缩放到 modelSize×modelSize，灰边填充 114。
   * 返回 { tensor, scale, padX, padY, imgWidth, imgHeight }
   */
  private async preprocess(
    imagePath: string
  ): Promise<{ tensor: ort.Tensor; scale: number; padX: number; padY: number; imgWidth: number; imgHeight: number }> {
    const metadata = await sharp(imagePath).metadata();
    const imgWidth = metadata.width!;
    const imgHeight = metadata.height!;

    // 计算 letterbox
    const scale = this.modelSize / Math.max(imgWidth, imgHeight);
    const newWidth = Math.round(imgWidth * scale);
    const newHeight = Math.round(imgHeight * scale);
    const padX = Math.floor((this.modelSize - newWidth) / 2);
    const padY = Math.floor((this.modelSize - newHeight) / 2);

    // Resize → add border (114 gray) → extract RGB → raw buffer
    const { data } = await sharp(imagePath)
      .resize(newWidth, newHeight)
      .extend({
        top: padY,
        bottom: this.modelSize - newHeight - padY,
        left: padX,
        right: this.modelSize - newWidth - padX,
        background: { r: 114, g: 114, b: 114 },
      })
      .removeAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });

    // RGB → CHW float32, normalize to [0, 1]
    const chw = new Float32Array(3 * this.modelSize * this.modelSize);
    const area = this.modelSize * this.modelSize;
    for (let i = 0; i < area; i++) {
      chw[i] = data[i * 3] / 255.0;               // R channel
      chw[area + i] = data[i * 3 + 1] / 255.0;     // G channel
      chw[2 * area + i] = data[i * 3 + 2] / 255.0; // B channel
    }

    const tensor = new ort.Tensor('float32', chw, [1, 3, this.modelSize, this.modelSize]);
    return { tensor, scale, padX, padY, imgWidth, imgHeight };
  }

  /**
   * 检测图片中的所有目标。
   * 返回按置信度降序排列。
   */
  async detect(
    imagePath: string,
    threshold: number = 0.5,
    iouThreshold: number = 0.45
  ): Promise<Detection[]> {
    if (!this.session) throw new Error('YoloDetector not loaded');

    const { tensor, scale, padX, padY, imgWidth, imgHeight } = await this.preprocess(imagePath);

    const feeds: Record<string, ort.Tensor> = {};
    const inputName = this.session.inputNames[0];
    feeds[inputName] = tensor;

    const results = await this.session.run(feeds);
    const outputName = this.session.outputNames[0];
    const output = results[outputName];

    return postProcess(
      output.data as Float32Array,
      output.dims,
      imgWidth,
      imgHeight,
      scale,
      padX / this.modelSize,
      padY / this.modelSize,
      threshold,
      iouThreshold,
      1  // 单类
    );
  }
}
