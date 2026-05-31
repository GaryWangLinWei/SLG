# 设备列表按指纹分组 & 展开激活码记录

**目标：** 管理面板设备列表每台设备只显示一行，可展开查看历史激活码。

**设计：**

- API `/api/admin/devices` 返回结构：

```json
{
  "devices": [{
    "device_fingerprint": "11d3e5...",
    "last_heartbeat_at": 1766000000000,
    "expires_at": 1870000000000,
    "codes": [
      { "code": "B3A9D6...", "bound_at": 1748450000000 },
      { "code": "BE507F...", "bound_at": 1748360000000 }
    ]
  }]
}
```

- `expires_at` 取该设备所有激活码中最大值（当前有效到期时间）
- `last_heartbeat_at` 取该设备所有绑定的最大值
- `codes` 按 `bound_at` 降序排列

**后端改动：**
- `HeartbeatService.ts` `getActiveDevices()` — GROUP BY fingerprint，聚合 codes 为子数组

**前端改动：**
- `admin.js` `loadDevices()` — 主表 5 列（指纹/最后心跳/到期时间/激活码记录/操作），点击切换展开 codes 子表
- 操作列：红色 ✕ 删除按钮，二次确认后调用 DELETE API
- `index.html` 表头相应调整

**后端改动：**
- `routes/admin.ts` 新增 `DELETE /api/admin/devices/:fingerprint` — 删除该设备所有绑定记录
