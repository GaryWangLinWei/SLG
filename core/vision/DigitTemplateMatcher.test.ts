import { getDigitMatcher } from './DigitTemplateMatcher';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import sharp from 'sharp';

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
 * 宝石数量：千位分隔符断链回归测试
 *
 * 宝石数量是带千位分隔符的 5 位数（如 "34,131"）。`nmsAndSort` 默认的锚点+间距贪婪连接
 * 用 maxDigitGap=20 裁剪相邻数字，而**跨逗号的数字间距实测在 19~22px 之间浮动**
 * （组内间距 12~15px）—— 正好卡在阈值 20 上下：
 *
 * - 间距 19px → 侥幸连上，读出完整值
 * - 间距 21~22px → 断在逗号处，只拿到一侧（"34" 或 "131"，取决于哪个簇分数最高）
 *
 * 这解释了线上现象：同一个真值有时读对、有时读成两三位。
 *
 * 修法不是调大 maxDigitGap（实测 g22/g26/g40/完全不裁剪输出一致，说明该守卫在此空转；
 * 且调大会放松距离识别对「公/里」误匹配的防护），而是让千位分隔符场景走
 * `gapChain: false`：按 x 升序取全部簇。
 *
 * 测试用仓库内的 digits_gem 模板**合成**截图，不依赖 temp/debug 下的真机截图 ——
 * 那些文件会被清理，且文件名带时间戳，按文件名索引真值会让测试在 fixture 更换后永久空跑。
 */
describe('DigitTemplateMatcher gem count', () => {
  const templatesDir = path.join(__dirname, '../../plugins/rok/templates/digits_gem');
  const gemDir = path.join(__dirname, '../../temp/debug/gem_count');
  const tmpFiles: string[] = [];

  afterAll(() => {
    for (const f of tmpFiles) fs.existsSync(f) && fs.unlinkSync(f);
  });

  /** 把 digits_gem 模板按给定 x 位置贴到 80x37 深色画布上，模拟宝石数量条 */
  async function synthesize(digits: number[], xs: number[], name: string): Promise<string> {
    const out = path.join(os.tmpdir(), name);
    tmpFiles.push(out);
    await sharp({
      create: { width: 80, height: 37, channels: 3, background: { r: 12, g: 14, b: 20 } },
    })
      .composite(digits.map((d, i) => ({
        input: path.join(templatesDir, `digit_${d}.png`),
        left: xs[i],
        top: 5,
      })))
      .png()
      .toFile(out);
    return out;
  }

  it('gapChain disabled bridges a 22px thousands-separator gap', async () => {
    // 34,131 —— 跨逗号间距 22px（x16→x38），组内 13/12/13px
    const p = await synthesize([3, 4, 1, 3, 1], [3, 16, 38, 50, 63], 'gem-syn-gap22.png');
    const matcher = await getDigitMatcher(templatesDir);

    // 默认路径（距离识别在用）保持原样：断在逗号处，只拿到右侧三位
    expect(await matcher.recognize(p, 0.75)).toBe('131');
    // 关掉间距裁剪后读全
    expect(await matcher.recognize(p, 0.75, { gapChain: false })).toBe('34131');
  }, 60000);

  it('a 19px gap slips under the old threshold, which is why the bug looked flaky', async () => {
    // 同样是 34,131，跨逗号间距 19px（x16→x35）→ 旧逻辑侥幸读全
    const p = await synthesize([3, 4, 1, 3, 1], [3, 16, 35, 47, 60], 'gem-syn-gap19.png');
    const matcher = await getDigitMatcher(templatesDir);

    expect(await matcher.recognize(p, 0.75)).toBe('34131');
    expect(await matcher.recognize(p, 0.75, { gapChain: false })).toBe('34131');
  }, 60000);

  it('real screenshots (if present) all read as 4-6 digit numbers', async () => {
    if (!fs.existsSync(gemDir)) return;
    const files = fs.readdirSync(gemDir).filter(f => f.endsWith('.png'));
    if (files.length === 0) return; // 截图已被清理，跳过

    const matcher = await getDigitMatcher(templatesDir);
    const failures: string[] = [];
    for (const f of files) {
      const got = await matcher.recognize(path.join(gemDir, f), 0.75, { gapChain: false });
      if (!/^\d{4,6}$/.test(got)) failures.push(`${f}: got "${got}"`);
    }
    expect(failures).toEqual([]);
  }, 120000);
});
