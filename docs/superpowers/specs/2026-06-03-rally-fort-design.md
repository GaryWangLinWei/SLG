# 自动攻打城寨 — 主动集结功能设计

## 概述

自动在世界地图上搜索野蛮人城寨，发起集结攻击。独立循环，不与其他 action 互斥。

## 功能开关

- `autoRallyFort: boolean` — 功能开关，默认 false
- `rallyFortTasks: { level: number; team: number }[]` — 最多 5 个配置项，默认 level=5, team 依次 1-5
- `rallyFortInterval: number` — 循环 CD，默认 600 秒（10 分钟）

## 循环模式

独立循环，有自己的 CD，不和其他 action（建筑升级、科技研究、采集等）互斥。

```
每轮:
  for each 已配置的 rallyFortTasks:
    acquireLock()
    runTask('rally-fort', { level, team })
    releaseLock()
  等待 CD（10min + jitter）
下一轮
```

## Action: `rally-fort`

**参数：** `{ level: number, team: number }`

**流程：**

1. **切城外** — `ensureInWorld()` 复用现有方法
2. **缩小地图** — ADB 双指捏合手势（两指往屏幕中心滑），扩大搜索视野
3. **螺旋搜索城寨** — `findImageWithLocation('ChengZhai.png')` 截图匹配，未找到则按螺旋方向滑动到下一个位置，上限 20 次
4. **OCR 识别等级** — 找到城寨后截取底部数字区域，OCR 读取等级并打印日志（`识别到 Lv.N 城寨`），与目标等级匹配则继续，不匹配则跳过继续搜索
5. **点击集结** — 点击城寨后等待集结界面弹出，模板识别"集结"按钮并点击
6. **确认集结时间** — 固定坐标点击确认按钮
7. **选队** — 复用 `gatherResources` 中的队伍选择逻辑（SELECT_TEAM_BUTTON + TEAM_BUTTONS + checkButtonStateChange）
8. **点击行军** — 固定坐标 `MARCH_BUTTON`（1154, 791）

**返回值：** `{ result: 'success' | 'not_found' | 'no_idle_teams' | 'team_unavailable', level: number }`

## 涉及文件

| 文件 | 改动 |
|------|------|
| `plugins/rok/homeFeatures.ts` | 新增 `autoRallyFort`、`rallyFortTasks`、`rallyFortInterval` 字段 |
| `plugins/rok/index.ts` | 注册 `rally-fort` action，`RokConfig` 新增坐标配置 |
| `plugins/rok/actions/rallyFort.ts` | 新建，实现 rally-fort action |
| `web/src/pages/Home.tsx` | 新增 rally 循环 + UI 卡片替换占位 |
| `plugins/rok/templates/` | 新增 `ChengZhai.png`、集结按钮模板 |

## 坐标 & 模板

**固定坐标（1080x1920）：**
- SELECT_TEAM_BUTTON: (1259, 180)
- TEAM_BUTTONS_NO_PAGE: 1(1378,292) 2(1378,359) 3(1378,430) 4(1378,499) 5(1378,565)
- TEAM_BUTTONS_PAGED: 1(1378,328) 2(1378,392) 3(1378,465) 4(1378,529) 5(1378,595)
- MARCH_BUTTON: (1154, 791)
- CLOSE_POPUP_BUTTON: (1392, 57)

**待用户提供：**
- `ChengZhai.png` — 城寨世界地图图标
- 集结按钮模板截图
- 确认集结时间按钮固定坐标
- 城寨等级数字 OCR 区域（相对于城寨图标的偏移量）

**已复用坐标：** 队伍选择和行军坐标复用 `gatherResources`。

## 未覆盖

- 加入别人的集结（后续实现）
- 双指捏合缩放的 ADB 实现方案（计划阶段细化）
