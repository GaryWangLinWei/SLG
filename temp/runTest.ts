import { YoloDetector } from '../core/vision/YoloDetector';
import * as fs from 'fs';
import * as path from 'path';

async function main() {
  const detector = await YoloDetector.create('D:/SLG/plugins/rok/models/gem.onnx');
  const dir = 'C:/Users/54459/Desktop/baoshiTest';
  const files = fs.readdirSync(dir).filter(f => f.endsWith('.png')).sort();

  const allResults: any[] = [];
  for (const f of files) {
    const dets = await detector.detect(path.join(dir, f), 0.5);
    console.log(f + ': ' + dets.length + ' gems');
    dets.forEach(d => console.log('  x='+d.x+' y='+d.y+' w='+d.width+' h='+d.height+' conf='+d.confidence.toFixed(3)));
    allResults.push({ file: f, dets: dets.map((d: any) => ({x:d.x,y:d.y,w:d.width,h:d.height,c:d.confidence}))});
  }
  fs.writeFileSync('D:/SLG/temp/detections.json', JSON.stringify(allResults, null, 2));
  console.log('\nSaved D:/SLG/temp/detections.json');
}
main().catch(e => { console.error(e); process.exit(1); });
