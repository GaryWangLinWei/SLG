# 教学网页实现计划

> **注意：** 等用户录好 B 站视频 + 提供截图后执行。

**目标：** 在 VPS 上搭建独立的 HTML 教学网页，嵌入 B 站操作演示视频 + 截图 + 文字说明。软件中点击"帮助"用浏览器打开该网页。

---

## 涉及改动

| 文件 | 改动 |
|------|------|
| `server-auth/help/index.html` | 新建，教学网页（纯静态 HTML + CSS，内联样式） |
| `server-auth/help/`（截图目录） | 新建，存放用户提供的截图文件 |
| `server-auth/index.ts` | 新增 `/help` 静态文件路由 |
| `web/src/App.tsx` | NavBar 添加"帮助"按钮，点击 `shell.openExternal()` 打开外部 URL |
| `electron/preload.ts` | 已有 `openExternal`（如无可新增） |
| `web/src/types/electron.d.ts` | 已有 `openExternal` 类型声明（如无可新增） |

---

## Task 1: 创建教学网页

**文件：** `server-auth/help/index.html`

- 纯静态 HTML，包含：
  - B 站视频嵌入（用户提供 iframe 嵌入代码）
  - 5 个操作步骤的截图 + 文字说明（用户提供截图文件 + 文案）
  - 响应式布局，移动端也可查看

## Task 2: server-auth 添加 /help 路由

直接在 `server-auth/index.ts` 中新增一行：

```typescript
app.use(mount('/help', serve(path.join(staticRoot, 'help'))));
```

## Task 3: 前端 NavBar 加"帮助"按钮

在 `web/src/App.tsx` 的 NavBar 中，"模拟器配置" Link 之后、"flex-1" div 之前，添加：

```tsx
<button
  onClick={() => {
    if (isElectron && window.electronAPI?.openExternal) {
      window.electronAPI.openExternal('http://106.15.11.158:3456/help');
    } else {
      window.open('http://106.15.11.158:3456/help', '_blank');
    }
  }}
  className="text-sm text-slate-500 hover:text-emerald-600 px-3 py-1.5 rounded hover:bg-slate-100"
  style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
>
  帮助
</button>
```

## Task 4: 部署到 VPS

- 上传 `server-auth/help/` 目录到 VPS
- 上传更新后的 `server-auth/dist/index.js`
- `pm2 restart slg-auth`

## 用户需提供

1. B 站视频嵌入代码（视频上传后在分享 → 嵌入代码中复制 iframe）
2. 5 步操作截图
3. 每步的标题和说明文案
