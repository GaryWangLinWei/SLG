// Debug script to trace YOLO detection pipeline
import { YoloDetector } from '../core/vision/YoloDetector';
import * as path from 'path';

async function main() {
  console.log('Loading model...');
  const d = await YoloDetector.create(path.join(__dirname, '..', 'plugins/rok/models/gem.onnx'));
  console.log('Model loaded');

  const testImg = 'C:/Users/54459/Desktop/baoshiTest/night1.png';
  console.log('Testing:', testImg);

  const dets = await d.detect(testImg, 0.5);
  console.log('Found:', dets.length, 'gems');
  for (const det of dets) {
    console.log(`  x=${det.x} y=${det.y} w=${det.width} h=${det.height} conf=${det.confidence.toFixed(4)}`);
  }
  if (dets.length === 0) {
    console.log('  WARNING: No detections found!');
  }
}
main().catch(e => { console.error('FAIL:', e.message || e); process.exit(1); });
