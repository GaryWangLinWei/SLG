import * as fs from 'fs';
import * as path from 'path';

describe('分享宝石矿 count100 停止条件', () => {
  const homeFeatures = fs.readFileSync(path.resolve(__dirname, '../homeFeatures.ts'), 'utf8');
  const home = fs.readFileSync(path.resolve(__dirname, '../../../web/src/pages/Home.tsx'), 'utf8');

  test('保留 count100 内部支持，但不在下拉选项中展示', () => {
    expect(homeFeatures).toContain("'count100'");
    expect(home).toContain("stopCond === 'count100' ? 100");
    expect(home).not.toContain('<option value="count100">');
  });
});
