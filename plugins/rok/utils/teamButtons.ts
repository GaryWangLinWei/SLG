/**
 * 队伍选择弹窗中 7 个队伍按钮的坐标表。
 * 弹窗顶部有"采集/集结"页签时（hasPaging=true），整体下移约 30px。
 * gatherResources / gatherGem 共用。
 */

export const TEAM_BUTTONS_NO_PAGE: Record<number, { x: number; y: number }> = {
  1: { x: 1378, y: 292 },
  2: { x: 1378, y: 359 },
  3: { x: 1378, y: 430 },
  4: { x: 1378, y: 499 },
  5: { x: 1378, y: 565 },
  6: { x: 1379, y: 633 },
  7: { x: 1381, y: 700 },
};

export const TEAM_BUTTONS_PAGED: Record<number, { x: number; y: number }> = {
  1: { x: 1378, y: 328 },
  2: { x: 1378, y: 392 },
  3: { x: 1378, y: 465 },
  4: { x: 1378, y: 529 },
  5: { x: 1378, y: 595 },
  6: { x: 1379, y: 669 },
  7: { x: 1381, y: 735 },
};

/** 根据是否有分页页签返回对应队伍按钮坐标表 */
export function getTeamButtons(hasPaging: boolean | null) {
  return (hasPaging ?? false) ? TEAM_BUTTONS_PAGED : TEAM_BUTTONS_NO_PAGE;
}
