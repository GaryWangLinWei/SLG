import * as fs from 'fs';
import * as path from 'path';

describe('gatherSharedGem 补池时机', () => {
  const source = fs.readFileSync(path.join(__dirname, 'gatherSharedGem.ts'), 'utf8');

  test('只在 action 入口补充一次，处理中不再补池', () => {
    const calls = source.match(/await refillIfNeeded\(ctx, accountId\)/g) ?? [];

    expect(calls).toHaveLength(1);
  });

  test('二次确认仅失败时保存调试截图', () => {
    expect(source).toContain("if (!verified.found) {\n      await saveDebugShot(ctx, 'verify_fail');");
    expect(source).not.toContain("'verify_success'");
  });
});
