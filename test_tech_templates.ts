#!/usr/bin/env ts-node

import * as path from 'path';
import * as fs from 'fs/promises';
import sharp from 'sharp';
import { Vision } from './core/vision/Vision';

// 输出目录：保存带红框标记的截图
const OUTPUT_DIR = 'C:/Users/54459/Desktop/techTest_results';

// 科技名称到模板文件名的映射（与 researchTech.ts 保持一致）
const TECH_TEMPLATES: Record<string, string> = {
  // === 经济科技 ===
  '采石': 'tech_caishi.png',
  '灌溉': 'tech_guangai.png',
  '手锯': 'tech_shouju.png',
  '镰刀': 'tech_liandao.png',
  '石工术': 'tech_shigongshu.png',
  '手斧': 'tech_shoufu.png',
  '冶金术': 'tech_yejinshu.png',
  '凿子': 'tech_zaozi.png',
  '文字': 'tech_wenzi.png',
  '金属加工': 'tech_jinshujiagong.png',
  '手推车': 'tech_shoutuiche.png',
  '多层建筑': 'tech_duocengjianzhu.png',
  '砂矿开采法': 'tech_shakuangcaifa.png',
  '车轮': 'tech_chelun.png',
  '珠宝': 'tech_zhubao.png',
  '耕犁': 'tech_plow.png',
  '锯木厂': 'tech_sawmill.png',
  '长柄大镰刀': 'tech_changbingdalindao.png',
  '工程学': 'tech_gongchengxue.png',
  '双人粗木锯': 'tech_shuangrencunmuju.png',
  '数学': 'tech_shuxue.png',
  '露天采石场': 'tech_lutiancaishichang.png',
  '铸币': 'tech_coin.png',
  '石锯': 'tech_shiju.png',
  '机械': 'tech_jiXie.png',
  '竖井开采法': 'tech_shujingcaifa.png',
  '辎重马车': 'tech_zizhongmache.png',
  '切割抛光工艺': 'tech_qiegepaoguang.png',
  // === 军事科技 ===
  '炼铁术': 'tech_liantieshu.png',
  '箭羽改良': 'tech_jianyugailiang.png',
  '骑术': 'tech_qishu.png',
  '燃烧弹': 'tech_ranshaodan.png',
  '剑士': 'tech_jianshi.png',
  '弓箭手': 'tech_gongjianshou.png',
  '轻骑兵': 'tech_qingqibing.png',
  '床弩': 'tech_chuangnu.png',
  '追踪术': 'tech_zhuizongshu.png',
  '寻路术': 'tech_xunlushu.png',
  '小圆盾': 'tech_xiaoyuandun.png',
  '皮甲': 'tech_pijia.png',
  '鳞甲': 'tech_linjia.png',
  '轮轴强化': 'tech_lunzhouqianghua.png',
  '枪兵': 'tech_qiangbing.png',
  '复合弓手': 'tech_fuhegongshou.png',
  '重骑兵': 'tech_zhongqibing.png',
  '投石车': 'tech_toushiche.png',
  '伪装术': 'tech_weizhuangshu.png',
  '战斗策略': 'tech_zhandoucelue.png',
  '防御阵型': 'tech_fangyuzhenxing.png',
  '草药': 'tech_caoyao.png',
  '制图学': 'tech_zhituxue.png',
  '长剑士': 'tech_changjianshi.png',
  '弩手': 'tech_nushou.png',
  '骑士': 'tech_qishi.png',
  '弩炮': 'tech_nupao.png',
  '乌兹钢': 'tech_wuzigang.png',
  '锥形箭': 'tech_zhuixingjian.png',
  '马镫': 'tech_madeng.png',
  '弹道学': 'tech_dandaoxue.png',
  '长鳞盾': 'tech_changlindun.png',
  '巨盾': 'tech_judun.png',
  '板甲': 'tech_banjia.png',
  '重型车架': 'tech_zhongxingchejia.png',
  '医疗部队': 'tech_yiliaobudui.png',
  '联合作战': 'tech_lianhezuozhan.png',
  '扎营防守': 'tech_zhayingfangshou.png',
};

const TEMPLATES_DIR = path.join(__dirname, 'plugins', 'rok', 'templates');
const TEST_DIR = 'C:/Users/54459/Desktop/techTest';
const MATCH_THRESHOLD = 0.65;

// 科技面板区域（1600×900 分辨率）
const TECH_PANEL_REGION = {
  x: 160,
  y: 180,
  width: 1060 - 160,
  height: 800 - 180
};

interface MatchResult {
  techName: string;
  confidence: number;
  x: number;
  y: number;
}

async function main() {
  console.log('=' .repeat(80));
  console.log('科技模板识别测试');
  console.log('=' .repeat(80));

  // 验证模板文件存在
  console.log('\n[1/3] 验证模板文件...');
  const missingTemplates: string[] = [];
  for (const [name, filename] of Object.entries(TECH_TEMPLATES)) {
    const templatePath = path.join(TEMPLATES_DIR, filename);
    try {
      await fs.access(templatePath);
    } catch {
      missingTemplates.push(`${name} (${filename})`);
    }
  }
  if (missingTemplates.length > 0) {
    console.log('  缺失的模板:');
    missingTemplates.forEach(t => console.log(`    - ${t}`));
  } else {
    console.log(`  ✓ 所有 ${Object.keys(TECH_TEMPLATES).length} 个模板文件存在`);
  }

  // 获取测试截图
  console.log('\n[2/3] 扫描测试截图...');
  let testFiles: string[] = [];
  try {
    testFiles = (await fs.readdir(TEST_DIR))
      .filter(f => f.endsWith('.png') || f.endsWith('.jpg'))
      .map(f => path.join(TEST_DIR, f));
    console.log(`  找到 ${testFiles.length} 张测试截图`);
  } catch (e) {
    console.log(`  ✗ 无法读取测试目录: ${TEST_DIR}`);
    return;
  }

  // 对每张截图进行识别
  console.log('\n[3/3] 模板匹配识别...');
  console.log('-' .repeat(80));

  const vision = new Vision();

  for (const screenshotPath of testFiles) {
    const filename = path.basename(screenshotPath);
    console.log(`\n📸 ${filename}`);

    try {
      const screenshot = sharp(screenshotPath);
      const metadata = await screenshot.metadata();
      console.log(`   尺寸: ${metadata.width}×${metadata.height}`);

      const allMatches: MatchResult[] = [];

      // 先裁剪到科技面板区域
      const croppedScreenshotPath = `${screenshotPath}_cropped.png`;
      await sharp(screenshotPath)
        .extract({
          left: TECH_PANEL_REGION.x,
          top: TECH_PANEL_REGION.y,
          width: TECH_PANEL_REGION.width,
          height: TECH_PANEL_REGION.height
        })
        .toFile(croppedScreenshotPath);

      // 与每个科技模板进行匹配（固定 1:1 比例，无需多尺度）
      for (const [techName, templateFile] of Object.entries(TECH_TEMPLATES)) {
        const templatePath = path.join(TEMPLATES_DIR, templateFile);

        try {
          const results = await vision.findAllImages(
            croppedScreenshotPath,
            templatePath,
            MATCH_THRESHOLD,
            [1.0]  // 截图与模板比例完全匹配，无需多尺度
          );

          for (const result of results) {
            allMatches.push({
              techName,
              confidence: result.confidence,
              x: result.location.x + TECH_PANEL_REGION.x,
              y: result.location.y + TECH_PANEL_REGION.y,
            });
          }
        } catch (e) {
          // 跳过错误的模板
        }
      }

      // 清理临时文件
      await fs.unlink(croppedScreenshotPath).catch(() => {});

      // 按置信度排序，去重（同一位置只保留最高置信度）
      const sortedMatches = allMatches
        .sort((a, b) => b.confidence - a.confidence)
        .filter((match, idx, arr) => {
          // 同一位置（x,y 相差<50像素）只保留最高置信度的
          return !arr.slice(0, idx).some(
            m => Math.abs(m.x - match.x) < 50 && Math.abs(m.y - match.y) < 50
          );
        });

      // 输出结果
      if (sortedMatches.length > 0) {
        console.log(`   识别到 ${sortedMatches.length} 个科技图标:`);
        sortedMatches.forEach((m, i) => {
          console.log(`     ${i + 1}. 【${m.techName}】 置信度: ${(m.confidence * 100).toFixed(1)}%  位置: (${m.x}, ${m.y})`);
        });

        // 生成带红框标记的截图
        await fs.mkdir(OUTPUT_DIR, { recursive: true });
        const outputFilename = `marked_${path.basename(screenshotPath)}`;
        const outputPath = path.join(OUTPUT_DIR, outputFilename);

        // 构建 SVG 红框叠加层
        let svgOverlays = '';
        sortedMatches.forEach(m => {
          const w = 90, h = 90; // 模板尺寸
          const x = m.x - Math.floor(w / 2);
          const y = m.y - Math.floor(h / 2);

          // 红色边框
          svgOverlays += `
            <rect x="${x}" y="${y}" width="${w}" height="${h}"
                  fill="none" stroke="#ff0000" stroke-width="3" />
            <rect x="${x}" y="${y}" width="${w}" height="${h}"
                  fill="rgba(255,0,0,0.15)" />
          `;

          // 科技名称标签
          const labelY = y - 5;
          svgOverlays += `
            <text x="${x + w / 2}" y="${labelY}"
                  text-anchor="middle" font-size="12" font-family="Microsoft YaHei"
                  fill="#fff" stroke="#000" stroke-width="1.5" paint-order="stroke">
              ${m.techName} ${(m.confidence * 100).toFixed(0)}%
            </text>
          `;
        });

        const svg = `
          <svg width="${metadata.width}" height="${metadata.height}" xmlns="http://www.w3.org/2000/svg">
            ${svgOverlays}
          </svg>
        `;

        await sharp(screenshotPath)
          .composite([{
            input: Buffer.from(svg),
            blend: 'over'
          }])
          .toFile(outputPath);

        console.log(`   ✅ 标记截图已保存: ${outputPath}`);
      } else {
        console.log('   未识别到任何科技图标');
      }

    } catch (e: any) {
      console.log(`   ✗ 处理失败: ${e.message}`);
    }
  }

  console.log('\n' + '=' .repeat(80));
  console.log('测试完成');
  console.log('=' .repeat(80));
}

main().catch(console.error);
