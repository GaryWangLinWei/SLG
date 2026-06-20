# Configurable Team Page Colors Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let users choose 蓝/红/黄 team page per feature instead of hardcoded team pages.

**Architecture:** Store team page choice in `HomeFeatures`, pass it from `Home.tsx` task params to ROK actions, and use the existing `ensureTeamPage(ctx, target, ...)` helper. Defaults preserve current behavior: 城寨=红, 资源=蓝, 宝石=蓝.

**Tech Stack:** React + TypeScript frontend, ROK plugin TypeScript actions, existing `TeamPage` utility.

---

### Task 1: Add HomeFeatures fields

**Files:**
- Modify: `plugins/rok/homeFeatures.ts`

- [ ] Add `TeamPageChoice = 'gather' | 'attack' | 'other'` export.
- [ ] Add fields: `rallyFortTeamPage`, `resourceGatherTeamPage`, `gemGatherTeamPage`.
- [ ] Defaults: `attack`, `gather`, `gather`.

### Task 2: Pass params from Home.tsx

**Files:**
- Modify: `web/src/pages/Home.tsx`

- [ ] Add migration fallbacks in `loadFeatures` for old localStorage/config.
- [ ] Pass `teamPage` to `gather-resources`, `rally-fort`, and gem actions.
- [ ] Add compact selects in the three feature cards with labels 蓝/红/黄.
- [ ] Update helper text to use selected color, not hardcoded red/blue.

### Task 3: Actions consume teamPage

**Files:**
- Modify: `plugins/rok/actions/rallyFort.ts`
- Modify: `plugins/rok/actions/gatherResources.ts`
- Modify: `plugins/rok/actions/gatherGem.ts`
- Modify if needed: `plugins/rok/actions/gatherGemFocus.ts`, `plugins/rok/index.ts`

- [ ] Import/use `TeamPage` type.
- [ ] Replace hardcoded `ensureTeamPage(..., 'attack'/'gather', ...)` with params/default.
- [ ] Preserve default behavior when param missing.

### Task 4: Verify

- [ ] Run `npx tsc --noEmit`.
- [ ] Run `cd web && npx tsc --noEmit`.
- [ ] Manual smoke: choose 黄 for one feature and verify logs say target 其他队伍.
