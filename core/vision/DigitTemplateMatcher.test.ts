import { getDigitMatcher } from './DigitTemplateMatcher';
import * as path from 'path';
import * as fs from 'fs';

/**
 * 数字模板匹配回归测试
 *
 * 覆盖场景：
 * - 城寨距离 OCR（screenshot 100x60，白底黑字，字符高 ~25px）
 * - joinRally 距离 OCR（screenshot 104x33，深红底白字，字符高 ~14px）
 *
 * 目的：`DigitTemplateMatcher.nmsAndSort` 的参数（minScore、clusterThreshold、maxDigitGap、scoreRatio）
 * 是所有 caller 共享的，改动一处会同时作用到城寨、joinRally、宝石数量。
 * 每次调整参数都跑一遍本文件确保不回归。
 */
describe('DigitTemplateMatcher regression', () => {
  const templatesDir = path.join(__dirname, '../../plugins/rok/templates/digits_distance');
  const chengbaoDir = path.join(__dirname, '../../temp/debug/chengbao_ocr');
  const joinRallyDir = path.join(__dirname, '../../temp/debug/joinrally_ocr');

  // 城寨：文件名 chengbao_<ts>_d<预期>.png
  // 注意：d3、d6、d37、d2308 是旧算法误识别的历史文件名，真值分别是 33、65、37、23
  const chengbaoExpected: Record<string, string> = {
    '26': '26', '47': '47', '36': '36', '16': '16',
    '3': '33',     // 旧算法丢第二位，真值 33
    '28': '28', '30': '30', '18': '18',
    '2308': '23',  // 旧算法误加"公里"里的位，真值 23
    '31': '31', '14': '14',
    '37': '37',
    '6': '65',     // 旧算法丢第二位，真值 65
    '53': '53', '19': '19', '65': '65', '24': '24',
  };

  // joinRally：文件名 dist_<ts>_d<识别结果>.png
  const joinRallyExpected: Record<string, string> = {
    '32': '3',   // 旧算法把"公"误识为 2，真值 3
    '20': '20',
  };

  it('chengbao distance OCR: all screenshots identified correctly', async () => {
    if (!fs.existsSync(chengbaoDir)) return; // skip 如果本地没有截图
    const matcher = await getDigitMatcher(templatesDir);
    const files = fs.readdirSync(chengbaoDir).filter(f => f.endsWith('.png'));
    const failures: string[] = [];
    for (const f of files) {
      const m = f.match(/_d([^.]+)\.png$/);
      if (!m) continue;
      const filenameLabel = m[1];
      const expected = chengbaoExpected[filenameLabel];
      if (expected === undefined) continue; // 未在预期表里的截图跳过
      const result = await matcher.recognize(path.join(chengbaoDir, f), 0.75);
      if (result !== expected) failures.push(`${f}: expected "${expected}", got "${result}"`);
    }
    expect(failures).toEqual([]);
  }, 60000);

  it('joinRally distance OCR: all screenshots identified correctly', async () => {
    if (!fs.existsSync(joinRallyDir)) return;
    const matcher = await getDigitMatcher(templatesDir);
    const files = fs.readdirSync(joinRallyDir).filter(f => f.endsWith('.png'));
    const failures: string[] = [];
    for (const f of files) {
      const m = f.match(/_d([^.]+)\.png$/);
      if (!m) continue;
      const filenameLabel = m[1];
      const expected = joinRallyExpected[filenameLabel];
      if (expected === undefined) continue;
      const result = await matcher.recognize(path.join(joinRallyDir, f), 0.75);
      if (result !== expected) failures.push(`${f}: expected "${expected}", got "${result}"`);
    }
    expect(failures).toEqual([]);
  }, 60000);
});
