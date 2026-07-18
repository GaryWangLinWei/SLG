import { YoloDetector } from './core/vision/YoloDetector';
import * as path from 'path';

async function detect() {
  const modelPath = path.join(__dirname, 'plugins/rok/models/state.onnx.bak');
  const detector = await YoloDetector.create(modelPath);
  const result = await detector.detect('C:/Users/54459/Desktop/QQ20260625-202751.png', 0.25, 0.45, [0,1,2,3]);

  const STATE_NAMES: Record<number, string> = { 0: '返回', 1: '采集', 2: '行军', 3: '驻扎' };
  console.log('检测结果:');
  if (result.length === 0) {
    console.log('  未检测到任何状态');
  }
  result.forEach(r => {
    console.log(`  ${STATE_NAMES[r.classIndex] || '未知'}: 置信度 ${(r.confidence * 100).toFixed(1)}%, 中心(${Math.round(r.x)},${Math.round(r.y)}) 框宽 ${Math.round(r.width)} 高 ${Math.round(r.height)}`);
  });
}

detect().catch(console.error);
