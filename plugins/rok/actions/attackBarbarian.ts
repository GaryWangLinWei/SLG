import { PluginContext } from '../../../core/plugin';
import { RokConfig } from '../index';
import { getTemplatesDir } from '../../../core/resourcePath';
import { ensureInWorld } from '../utils/location';
import { ensureTeamPage, TeamPage } from '../utils/teamPage';
import { detectTeamStates } from '../utils/teamStateDetection';
import { handleMarchWithStamina } from '../utils/stamina';
import { ocrService } from '../../../core/ocr/OcrService';
import * as path from 'path';
import * as fsp from 'fs/promises';
import sharp from 'sharp';

const TEMPLATE_DIR = getTemplatesDir();
const BARB_MAX_LEVEL = 40;

const SEARCH_ENTRY_RECT = { x1: 42, y1: 645, x2: 110, y2: 704 };
const BARBARIAN_TAB_POINT = { x: 148, y: 294 };
const LEVEL_OCR_RECT = { x1: 126, y1: 425, x2: 564, y2: 454 };
const LEVEL_MINUS_RECT = { x1: 102, y1: 467, x2: 137, y2: 501 };
const LEVEL_PLUS_RECT = { x1: 539, y1: 467, x2: 576, y2: 501 };
const LEVEL_RESET_BTN = { x: 167, y: 486 };
const SEARCH_ACTION_RECT = { x1: 244, y1: 561, x2: 436, y2: 626 };

const WORLD_SWITCH_BUTTON_RECT = { x1: 39, y1: 776, x2: 115, y2: 858 };
const CLOSE_POPUP_BUTTON = { x: 1392, y: 57 };
const CLOSE_STAMINA_POPUP = { x: 1363, y: 103 };
const TILI_BUTTON_REGION = { x: 1014, y: 242, width: 1358 - 1014, height: 407 - 242 };

const BTN_ATTACK_TEMPLATE = path.join(TEMPLATE_DIR, 'btn_attack.png');
const BTN_BIANDUI_TEMPLATE = path.join(TEMPLATE_DIR, 'jijie', 'btn_biandui.png');
const BTN_XINGJUN_TEMPLATE = path.join(TEMPLATE_DIR, 'btn_xingjun.png');
const BTN_XINGJUN_REGION = { x: 1068, y: 20, width: 362, height: 860 };
const PAGE_INDICATOR_TEMPLATE = path.join(TEMPLATE_DIR, 'btn_page_indicator.png');
const SUREGO_TEMPLATE = path.join(TEMPLATE_DIR, 'jijie', 'btn_surego.png');

const MARCH_BUTTON_RECT = { x1: 1031, y1: 754, x2: 1292, y2: 820 };
const MARCH_BUTTON = { x: 1154, y: 791 };

const TEAM_BUTTONS_NO_PAGE: Record<number, { x: number; y: number }> = {
  1: { x: 1378, y: 362 }, 2: { x: 1378, y: 430 },
  3: { x: 1378, y: 497 }, 4: { x: 1378, y: 566 }, 5: { x: 1378, y: 633 },
};
const TEAM_BUTTONS_PAGED: Record<number, { x: number; y: number }> = {
  1: { x: 1378, y: 397 }, 2: { x: 1378, y: 463 },
  3: { x: 1378, y: 533 }, 4: { x: 1378, y: 600 }, 5: { x: 1378, y: 671 },
};

const LARGE_REGION = { x: 1443, y: 53, w: 152, h: 753 };
const AVATAR_OFFSET = { dx: -25, dy: -25 };
const TOP_SLOT_REGION = { x1: 1530, y1: 220, x2: 1582, y2: 310 };

const ZHUZHA_WAIT_TIMEOUT_SEC = 300;
const ZHUZHA_POLL_INTERVAL_SEC = 5;

export type AttackBarbarianResult =
  | 'success' | 'not_found' | 'no_attack_button' | 'no_biandui'
  | 'team_unavailable' | 'stamina_insufficient' | 'zhuzha_timeout';

export interface AttackBarbarianParams {
  level: number;
  count: number;
  team: number;
  teamPage: TeamPage;
  usePotion: boolean;
}

export function neighborLevelOrder(target: number, maxLevel: number): number[] {
  const order: number[] = [];
  const seen = new Set<number>([target]);
  for (const d of [-1, +1, -2, +2]) {
    const lv = target + d;
    if (lv >= 1 && lv <= maxLevel && !seen.has(lv)) { order.push(lv); seen.add(lv); }
  }
  return order;
}
