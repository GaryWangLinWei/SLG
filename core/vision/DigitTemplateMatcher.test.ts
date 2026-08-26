import { getDigitMatcher, expectedGlyphGroups } from './DigitTemplateMatcher';
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

/**
 * 宝石数量识别回归测试
 *
 * 背景：宝石数量是带千位分隔符的 5 位数（如 "43,106"）。`nmsAndSort` 的锚点+间距贪婪连接
 * 用 maxDigitGap=20 裁剪，而跨逗号的相邻数字间距实测稳定为 21~22px（组内间距 10~15px），
 * 导致链条必然断在逗号处，只能拿到逗号一侧 —— 同一真值 43,106 会随机识别成 "43" 或 "106"，
 * 取决于哪个簇碰巧分数最高。
 *
 * 修法不是调大 maxDigitGap（那只是把赌注换个位置，且会把距离识别的"公/里"防护一起放松），
 * 而是让紧裁剪、区域内只有数字的场景走 `gapChain: false`：按 x 升序取全部簇。
 *
 * 下方真值表中的文件名前缀是**旧算法的截断结果**，真值由逐字形渲染人工核对得出。
 */
describe('DigitTemplateMatcher gem count', () => {
  const templatesDir = path.join(__dirname, '../../plugins/rok/templates/digits_gem');
  const gemDir = path.join(__dirname, '../../temp/debug/gem_count');

  // 文件名 <旧算法误识别结果>_<ts>.png → 真值
  // null = 模板未命中全部数字，结构校验应拒绝（不得返回看起来合理的错值）
  const gemExpected: Record<string, string | null> = {
    '101_1785885938485.png': '34101',
    '106_1785792729930.png': '43106',
    '122_1784891370857.png': '24122',
    '126_1785676506435.png': '32126',
    '132_1785749587322.png': '33132',
    '134_1784969871078.png': '26134',
    '134_1784969872046.png': '26134',
    '142_1784891748225.png': '24142',
    '146_1784984726039.png': '26146',
    // 真值 25,275。该截图字形明显更宽（数字间距 14px vs 其他 10~13px），
    // 模板尺度不匹配漏掉末位 5 —— 属于独立问题，此处只要求结构校验能识别出"读数不完整"。
    '27_1784937467944.png': null,
    '43_1785793089410.png': '43106',
    '43_1785793149481.png': '43106',
    '43_1785795370030.png': '43192',
    '43_1785795669555.png': '43192',
    '43_1785795849531.png': '43192',
  };

  it('reads full thousands-separated numbers with gapChain disabled', async () => {
    if (!fs.existsSync(gemDir)) return; // skip 如果本地没有截图
    const matcher = await getDigitMatcher(templatesDir);
    const failures: string[] = [];

    for (const [file, expected] of Object.entries(gemExpected)) {
      const p = path.join(gemDir, file);
      if (!fs.existsSync(p)) continue;

      const r = await matcher.recognizeDetailed(p, 0.75, { gapChain: false });
      const structureOk = r.glyphGroups === expectedGlyphGroups(r.digitCount);

      if (expected === null) {
        if (structureOk) {
          failures.push(
            `${file}: 期望结构校验失败，但通过了 (text="${r.text}" digits=${r.digitCount} groups=${r.glyphGroups})`
          );
        }
        continue;
      }

      if (!structureOk) {
        failures.push(
          `${file}: 结构校验意外失败 (text="${r.text}" digits=${r.digitCount} groups=${r.glyphGroups})`
        );
      } else if (r.text !== expected) {
        failures.push(`${file}: expected "${expected}", got "${r.text}"`);
      }
    }

    expect(failures).toEqual([]);
  }, 120000);

  it('default gapChain still truncates at the comma (documents the old behaviour)', async () => {
    if (!fs.existsSync(gemDir)) return;
    const matcher = await getDigitMatcher(templatesDir);
    const p = path.join(gemDir, '106_1785792729930.png');
    if (!fs.existsSync(p)) return;

    // 默认路径（距离识别在用）保持原样：断在逗号处，只拿到一侧
    const chained = await matcher.recognize(p, 0.75);
    expect(chained).toBe('106');

    // 关掉间距裁剪后拿到完整值
    const full = await matcher.recognizeDetailed(p, 0.75, { gapChain: false });
    expect(full.text).toBe('43106');
  }, 60000);
});

describe('expectedGlyphGroups', () => {
  it('counts digits plus thousands separators', () => {
    expect(expectedGlyphGroups(3)).toBe(3);     // 562
    expect(expectedGlyphGroups(4)).toBe(5);     // 1,234
    expect(expectedGlyphGroups(5)).toBe(6);     // 43,106
    expect(expectedGlyphGroups(6)).toBe(7);     // 123,456
    expect(expectedGlyphGroups(7)).toBe(9);     // 1,234,567
  });

  it('returns 0 for empty input', () => {
    expect(expectedGlyphGroups(0)).toBe(0);
  });
});
