import * as fs from 'fs';
import * as path from 'path';

describe('gather-shared-gem CD', () => {
  test('基础间隔为 60 秒', () => {
    const homePath = path.resolve(__dirname, '../../../web/src/pages/Home.tsx');
    const source = fs.readFileSync(homePath, 'utf8');

    expect(source).toContain("const intervalSec = useShared ? 60 : (isFocus ? 60 : 300);");
  });
});
