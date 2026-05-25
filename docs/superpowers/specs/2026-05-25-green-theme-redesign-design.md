# Green Theme UI Redesign

## Summary

Replace the current blue-based UI theme with an emerald green design system
inspired by the reference HTML mockup. All existing functionality is preserved —
only visual style, component shapes, and color tokens change.

## Design Tokens

| Token | Old (Blue) | New (Green) |
|-------|-----------|-------------|
| Primary | `blue-600` `#2563EB` | `emerald-500` `#10B981` |
| Primary hover | `blue-700` | `emerald-600` `#059669` |
| Primary light | `blue-100` `#DBEAFE` | `emerald-100` `#D1FAE5` |
| Page bg | `bg-blue-50` `#EFF6FF` | `bg-slate-100` `#F1F5F9` |
| Card bg | `bg-white` | `bg-white` (unchanged) |
| Card border | `border-gray-100` | `border-slate-100` `#F1F5F9` |
| Text primary | `text-gray-900` | `text-slate-800` `#1E293B` |
| Text secondary | `text-gray-500/600` | `text-slate-500` `#64748B` |
| Text muted | `text-gray-400` | `text-slate-400` `#94A3B8` |
| Border | `border-gray-200/300` | `border-slate-200` `#E2E8F0` |
| Button shape | `rounded-xl` | `rounded-full` (pill) |
| Toggle | Native checkbox | Custom pill toggle (`#10B981` when on) |

## Component Changes

### Toggle Switch
- Replace all native `<input type="checkbox">` with custom pill toggle
- 40×22px pill, slides right when checked, green bg when active
- Reusable component or Tailwind-styled span

### NavBar (App.tsx)
- Brand: gradient green logo block (`#10B981` → `#34D399`) with icon
- Active tab: `bg-emerald-100 text-emerald-500`
- Inactive tab: `text-slate-500`, hover `bg-slate-100 text-slate-800`
- Minimize/close buttons: bordered square with hover effect

### Status Bar (Home.tsx)
- Replace centered white "一键全能模式" card with horizontal green gradient banner
- `bg-gradient-to-r from-emerald-50 to-emerald-100`, border `border-emerald-300`
- Left: icon block (green bg, white icon) + status text
- Right: interval input + run/stop button (pill, green gradient, shadow)

### Feature Cards (Home.tsx)
- 2-column grid, white cards with border
- Active (checked): `border-emerald-500 bg-green-50/50`
- Inactive (unchecked): `border-slate-200`
- Each feature gets distinct icon bg color:
  - 升级建筑: green (`bg-emerald-100`)
  - 研究科技: blue (`bg-blue-100`)
  - 资源采集: orange (`bg-amber-100`)
  - 训练兵种: red (`bg-red-100`)
  - 帮助盟友: purple (`bg-purple-100`)
  - 收集资源: green (`bg-emerald-100`)
  - 自动探索: cyan (`bg-cyan-100`)
- "Coming soon" disabled items: blur overlay with lock badge (instead of dashed border + opacity)

### Buttons
- Primary action: `rounded-full`, green gradient bg, green glow shadow
- Stop button: `rounded-full`, red bg
- Connect button: `rounded-full`, green bg

### Log Panel (Home.tsx)
- Dark terminal bg (`#0F172A`), monospace font
- Colored log lines: success=green, info=blue, error=red
- Scrollbar styled to match dark theme

### Other Pages
- Config, Accounts, Activation, Tasks, Plugins: same token migration, green replaces blue everywhere
- Forms: focus ring `emerald-500`, selects/inputs same border style

## Files Changed

| File | Scope |
|------|-------|
| `web/src/App.tsx` | NavBar colors, brand logo, active tab, license badge |
| `web/src/pages/Home.tsx` | Status bar, toggle switches, feature cards, buttons, log panel |
| `web/src/pages/Config.tsx` | Color tokens, form controls |
| `web/src/pages/Accounts.tsx` | Color tokens |
| `web/src/pages/Activation.tsx` | Color tokens, buttons |
| `web/src/pages/Tasks.tsx` | Color tokens |
| `web/src/pages/Plugins.tsx` | Color tokens |

## Constraints

- All existing functionality preserved — no features added or removed
- Building selects, tech selects, gather options, train tier selects, interval input, config dropdown all remain
- The "一键全能模式" concept stays; only the visual container changes from centered card to horizontal banner
- Coming-soon placeholders (攻打山寨, 采集宝石) keep their disabled state, just styled differently
