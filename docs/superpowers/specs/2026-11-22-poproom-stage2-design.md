# 轻橘 PopRoom（第二阶段：沟通协作闭环、自动归档与高频体验补强）设计文档

- **日期**：2026-11-22
- **状态**：已确认采用方案 A（Expo Go 全程可验）
- **前置基线**：第一阶段 MVP（[2026-11-22-poproom-mvp-design.md](./2026-11-22-poproom-mvp-design.md)）
- **参考蓝图**：[app.md](../../../app.md)

---

## 1. 意图与定位

第一阶段已完成“账号 → 建房/6 位码进房 → 四大积木实时协作 → 操作日志撤销 → 手动归档与复盘导出”的核心骨架。第二阶段（**方案 A**）在不脱离 **Expo Go 双机秒测** 的前提下，补齐轻橘 PopRoom 最具差异化的产品灵魂——**“协作优先、沟通为辅、用完即归档”**：

1. **房主可控轻量聊天室与双向联动**：把“群聊拍板但结论沉底”的痛点闭环——在房间内按需开启聊天室，支持消息一键转为分工任务/日程条目，也支持房主从投票/分工积木发出催办卡片直达对应模块。
2. **UGC 合规与秩序底座**：为聊天室配套房主/本人删消息、成员举报（`message_reports`）与拉黑屏蔽（`user_blocks` 数据库层 + 前端双重过滤，并支持个人中心解除屏蔽）。
3. **7 天自动归档生命周期**：通过 Supabase `pg_cron` 每日扫描 `event_end_at` 已过期 7 天的活跃房间并自动归档，同时在设置页开放活动起止时间编辑。
4. **高频协作体验补强**：补齐第一阶段实测中最容易碰到的 3 个缺口——**积木上下排序**、**非房主成员主动退出活跃房间**、**调用系统原生分享面板邀请成员**。

---

## 2. 目标、非目标与反目标

### 2.1 目标（第二阶段必达）
1. **房主可控双 Tab 房间体验**：`rooms.chat_enabled === true` 时在房间顶部显示 `协作看板 | 聊天室`（默认仍落脚 `协作看板`），未读消息仅在 `聊天室` Tab 右上角展示数字红点；模板建房恢复差异化默认值（`campus` / `travel` 默认开，`party` / `custom` 默认关），房主可在建房页和设置页随时开关。
2. **聊完转积木 & 积木催办卡片**：
   - 长按聊天文本消息 → `转为分工任务` / `加入日程轴` / `复制内容` / `举报消息` / `屏蔽此人` / `删除消息`（房主/管理员或发送者本人）。选择转换后自动切回看板并预填文本打开对应新建抽屉；若房间内尚无目标积木，房主/管理员自动新建对应积木再预填，普通成员收到清晰提示。
   - 投票 / 分工积木卡片右上角提供“发送到聊天室提醒”（房主/管理员在开启聊天室时可见），插入 `msg_type = 'block_card'` 互动卡片；成员点击卡片自动切回看板、滚动至目标积木并显示 2 秒高亮框。
3. **实时未读与合规闭环**：`room_messages` 接入房间级 Realtime；通过 `room_chat_reads` 持久化每位成员的已读游标；拉黑后对方消息在数据库 RLS 与前端即时双层隐藏，绝不计入未读红点，且个人中心支持管理并解除屏蔽；归档后聊天室同步只读（仅举报与屏蔽仍可用）。
4. **7 天自动归档 + 体验补丁**：提供 `auto_archive_expired_rooms()` 与幂等 `pg_cron` 定时任务配置；支持管理员调整积木顺序（`reorder_room_blocks`）、非房主退出活跃房间（`leave_room`）、设置页编辑活动起止时间、一键调用系统分享面板发送房间码与邀请链接。

### 2.2 非目标（明确留待第三阶段 / EAS Development Build）
- 远程推送通知（`expo-notifications`、APNs/FCM、Supabase Edge Functions、5 类推送触发器）。
- 第三方/原生登录（Apple 登录、微信/QQ 一键登录、短信验证码）与账号注销/应用商店上架包配置。
- 聊天室发图/语音/视频消息（第二阶段聚焦轻量文本、`@提及` 与积木催办卡片，坚持“沟通为辅”定位）。

### 2.3 反目标
- **喧宾夺主做成 IM 软件**：进入房间默认必须是 `协作看板`，严禁普通消息弹全屏/顶部强打扰通知，聊天室关闭时不得在界面残留多余入口。
- **破坏 Expo Go 兼容或已有归档只读铁律**：不得引入需自定义原生构建的依赖；已归档房间禁止发消息、删消息、排序积木或退房（防止破坏复盘和 AA 分账的历史成员引用）。
- **屏蔽失效或越权操作**：被拉黑用户的消息不得通过 Realtime 漏出或增加未读数；普通成员不得发送 `@全体成员` 或 `block_card` 催办卡片。

---

## 3. 架构方案对比与已选方向

在构思第二阶段时对比了三条路线：
- **方案 A（已选）：沟通协作闭环 + 自动归档 + 高频体验补强（Expo Go 全程可验）** — 完整兑现 PopRoom 产品定位，零原生打包门槛，双机 Expo Go 直接联调，为第三阶段推送/上架打牢聊天与合规数据层。
- **方案 B：跳过聊天室先做远程推送** — 必须立刻切入 EAS Development Build 与 APNs/FCM 凭据配置，联调门槛陡增且房间内仍缺“聊完转积木”的核心闭环。
- **方案 C：聊天室 + 推送 + 上架登录合并冲刺** — 横跨四条独立链路，排障面过大、易互相阻塞。

---

## 4. 核心设计要点

### 4.1 数据库增量迁移（不修改 001–003）
- **`004_stage2_chat_and_compliance.sql`**：新增 `room_messages`（加入 `supabase_realtime`，继续严格排除 `poll_votes`）、`message_reports`（`UNIQUE(message_id, reporter_id)`）、`user_blocks`（`PRIMARY KEY(blocker_id, blocked_id)`，`CHECK(blocker_id <> blocked_id)`）、`room_chat_reads`（`PRIMARY KEY(room_id, user_id)`）；扩展 `activity_logs.action` 支持 `delete_message` 与 `leave_room`；配置四张新表 RLS（`room_messages` 强制写操作走 RPC，读取时自动过滤 `is_deleted = FALSE` 与 `user_blocks`）。
- **`005_stage2_rpcs_and_auto_archive.sql`**：
  - 兼容升级 `create_room_with_template(..., p_chat_enabled BOOLEAN DEFAULT NULL)`：未传时按模板默认（`campus`/`travel` 为 `TRUE`，`party`/`custom` 为 `FALSE`）。
  - 新增 `send_room_message`、`soft_delete_room_message`、`report_room_message`、`reorder_room_blocks`、`leave_room`、`auto_archive_expired_rooms` 六个 `SECURITY DEFINER` RPC（统一 `SET search_path = public`）。
  - 条件注册 `pg_cron` 每日任务 `poproom-auto-archive-daily`（UTC `0 19 * * *`，北京时间凌晨 03:00）。

### 4.2 关键业务规则
- **权限边界**：`mentionAll` 与 `block_card` 仅 `host`/`admin` 可发；删消息允许 `host`/`admin` 或消息发送者本人（活跃房间内）；举报与屏蔽在活跃与归档房间均可用；`leave_room` 仅限非 `host` 成员且仅限活跃房间（返回 `HOST_CANNOT_LEAVE` / `ROOM_ARCHIVED`）。
- **未读计数规则**：`unread = messages.filter(m => !m.is_deleted && m.sender_id !== currentUserId && !blockedIds.has(m.sender_id) && (!lastReadAt || m.created_at > lastReadAt)).length`。进入聊天室 Tab 或在聊天室收到新消息时自动刷新 `room_chat_reads.last_read_at`。
- **单手轻交互**：长按消息菜单、举报理由、屏蔽确认、`@成员` 选择器、退房确认全部复用已修复的 [SheetModal.tsx](../../../src/components/ui/SheetModal.tsx)。
