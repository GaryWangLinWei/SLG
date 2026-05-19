# 多账号配置 — 设计文档

**Goal:** 坐标配置页支持保存最多 5 份命名配置，玩家可快速切换不同游戏角色的建筑布局。

**Scope:** 同一 ADB 设备（Account）下多份配置，不同角色不同布局。

---

## 数据模型

**存储文件：** `~/.slg-automation/configs/{accountId}.json`

**新格式：**

```json
{
  "activeConfigName": "默认配置",
  "configs": {
    "默认配置": { "...完整 RokConfig..." },
    "小号": { "...完整 RokConfig..." }
  }
}
```

- 每个 config 内部是完整的 `RokConfig`，结构不变
- 最多 5 个，ConfigService 和前端双重校验
- 配置名同 account 内不可重复

**自动迁移：** 首次读取时检测旧格式（根层级有 `buildingPositions`，无 `configs` 字段），自动包装为新格式，默认命名为「默认配置」。

---

## API

| 方法 | 路径 | 说明 |
|------|------|------|
| `GET` | `/api/config/rok?accountId=xxx` | 取当前激活配置（不变，Home 页兼容） |
| `GET` | `/api/config/rok?accountId=xxx&name=yyy` | 取指定名称的配置 |
| `PUT` | `/api/config/rok?accountId=xxx&name=yyy` | 保存配置到指定名称 |
| `GET` | `/api/config/rok/profiles?accountId=xxx` | 返回 `{ profiles: string[], active: string }` |
| `POST` | `/api/config/rok/switch?accountId=xxx` | body `{ name }` 切换激活 |
| `DELETE` | `/api/config/rok?accountId=xxx&name=yyy` | 删除配置（不允许删最后一个） |

---

## 涉及文件

| 操作 | 文件 | 说明 |
|------|------|------|
| 修改 | `server/routes/config.ts` | 新增 profiles/switch/delete 路由 |
| 修改 | `server/services/ConfigService.ts` | 多配置读写、迁移、5 上限校验 |
| 修改 | `web/src/pages/Config.tsx` | 配置管理栏（选择/新建/重命名/删除） |
| 修改 | `web/src/pages/Home.tsx` | 显示当前配置名 |
| 修改 | `web/src/api/client.ts` | 新增前端 API 方法 |
| 修改 | `plugins/rok/index.ts` | 更新 `getConfig` 逻辑（按名称加载） |

---

## Config 页面 UI

```
┌─────────────────────────────────────────────────┐
│  配置：[默认配置 ▾]  [新建] [重命名] [删除]      │
│  (最多 5 个)                                     │
└─────────────────────────────────────────────────┘
│              截图/标注区域（不变）                  │
```

- **下拉选择器**：切换时自动加载对应建筑的坐标
- **新建**：弹窗输入名称，以 DEFAULT_ROK_CONFIG 为基础
- **重命名**：弹窗修改（= PUT 新名 + DELETE 旧名）
- **删除**：二次确认，仅剩 1 个时禁用
- **保存**：逻辑不变，保存到当前选中配置名

## Home 页面

账号名旁显示当前配置名（只读），从 `/api/config/rok/profiles` 获取：

```
👤 模拟器1 | 📐 默认配置
```

---

## 校验规则

- 配置名不能为空，不能重复（同 account 内）
- 最多 5 个配置 — 前端按钮禁用 + 后端拒绝
- 不能删除最后一个配置 — 前端禁用 + 后端拒绝
- 删除配置后如果被删的是 active，自动切换到第一个
