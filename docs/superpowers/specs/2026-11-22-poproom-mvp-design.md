# 轻橘 PopRoom（第一阶段 MVP：核心协作闭环）设计文档

- **日期**：2026-11-22
- **状态**：待最终确认
- **工作规模**：完整项目（从零搭建 Expo 移动端应用 + Supabase 后端）
- **参考来源**：[app.md](../../../app.md) 及需求澄清记录

---

## 1. 意图与初衷

**轻橘 PopRoom** 是一款面向 **3–20 人中小型临时活动**（校园社团活动、班级聚会、朋友聚餐、周末野营出游等）的轻量化多人协作移动 App。

核心理念为 **“一件事一个房间，协作优先、沟通为辅、用完即归档”**：由活动组织者创建专属房间，邀请成员进入，所有人围绕具体事项（投票决策、分工认领、日程同步、费用结算）共同推进并完成整个活动，避免关键结论淹没在群聊记录里。

**第一阶段落地定位（方向 A）**：优先做出一个**小范围真机可用（Expo Go 可直接验证）的 MVP**，聚焦核心协作闭环，让你和身边的 3–20 位朋友装上就能真实组织一次活动，同时在数据库与代码结构上为第二阶段（聊天室、推送通知、定时自动归档、上架合规）预留平滑扩展位。

---

## 2. 目标、非目标与反目标

### 2.1 目标（第一阶段必达）
1. **端到端协作闭环**：邮箱密码注册/登录 + 首次昵称与色块头像设置 → 活动大厅（进行中房间 + 折叠已归档房间）→ 4 套模板一键建房 → 6 位房间码与邀请链接进房（两档门禁）→ 房间内四大积木实时协作 → 房主管理与软删除一键撤销 → 手动归档与活动复盘导出（高清长图 / PDF）。
2. **数据一致性与隐私兜底**：所有跨表及权限敏感写操作通过 PostgreSQL 原子 RPC 完成；投票记录独立建表（`poll_votes`），消除并发覆盖与匿名投票身份泄露；归档后在数据库 RLS 与 RPC 层彻底锁定只读。
3. **移动端单手丝滑体验**：高频操作（投票、认领任务、记账、新建条目）统一走底部抽屉（BottomSheet）；投票与任务状态切换采用乐观更新；日程与房间数据支持离线读取。
4. **强类型与可测试性**：TypeScript 严格模式禁用 `any`；所有 `JSONB` 字段通过 Zod 契约校验；AA 最小转账分账算法与权限逻辑具备单元测试。

### 2.2 非目标（明确延后至第二阶段）
以下能力不在第一阶段实现，仅在数据模型或路由结构上保留扩展位：
- **房间轻量聊天室**（`ChatRoomView`、`@提及`、长按消息转积木、积木催办卡片）——仅在 `rooms` 表保留 `chat_enabled` 字段（第一阶段固定为 `false`）。
- **远程推送通知**（`expo-notifications`、Supabase Database Webhooks、Edge Functions、FCM/APNs）。
- **7 天定时自动归档**（`pg_cron` 后台任务）——第一阶段采用房主手动归档。
- **应用商店上架相关能力**（Apple 登录、微信/QQ 一键登录、短信验证码、消息举报 `message_reports` 与拉黑 `user_blocks` 界面）。

### 2.3 反目标（即使技术跑通也算失败）
- **做成重型项目管理工具**：出现多级表单跳转、横向滚动大表格或复杂权限配置，违背“轻量单手”定位。
- **多人并发协作丢数据或串隐私**：10 人同时点投票互相覆盖、或开启匿名投票后前端网络包仍能看到投票人 ID。
- **破坏 Expo Go 真机验收**：第一阶段引入必须打原生包的依赖导致无法直接用 Expo Go 联调。
- **手滑不可恢复**：成员误删日程或账单后无法撤销，导致活动现场混乱。

---

## 3. 约束条件

1. **锁定技术栈**（沿用 `app.md`）：
   - **前端**：Expo（SDK 52+，兼容 Expo Go）+ React Native + Expo Router + TypeScript（Strict Mode，禁止 `any`）
   - **UI 与交互**：NativeWind v4（Tailwind CSS）+ `lucide-react-native` + `@gorhom/bottom-sheet`（配合 `react-native-gesture-handler` 与 `react-native-reanimated`）
   - **状态与离线缓存**：TanStack Query v5 + `@tanstack/query-async-storage-persister` + `@react-native-async-storage/async-storage` + Zustand（仅存局部 UI 轻状态）
   - **后端与实时**：Supabase（PostgreSQL + Auth + Realtime + Storage），客户端会话通过 `expo-secure-store` 持久化
   - **校验与工具**：Zod、`expo-linking`（深度链接与外部地图唤起）、`expo-image-picker`（任务实拍图与报销凭证）、`react-native-view-shot`（复盘长图）、`expo-print` + `expo-sharing`（PDF 生成与系统分享）
2. **Supabase 免费版邮件限频约束**：默认 SMTP 约每小时 2 封邮件。第一阶段采用**邮箱 + 密码**登录，并在 Supabase Auth 控制台关闭“Confirm Email”强制验证，保证 3–20 人可同时秒级注册登录。
3. **归档只读铁律**：当 `rooms.status = 'archived'` 时，所有写操作（RLS 策略与写 RPC）必须在服务端拒绝，客户端同步切换为只读视图（仅允许查看与导出复盘）。
4. **国内真机地图唤起**：日程轴“一键导航”需兼容国内常见地图 App（高德、百度）及系统地图（Apple Maps / 默认地理协议），并提供“复制地点名”兜底。

---

## 4. 构建方案对比与选型

在敲定设计前，评估了三种基于既定技术栈的落地路径：

| 方案 | 核心思路 | 主要优势 | 主要取舍 |
| :--- | :--- | :--- | :--- |
| **方案 A：Supabase 原子 RPC 写边界 + 分里程碑真机联调（已选）** | 跨表/权限敏感写操作收口到 PostgreSQL `SECURITY DEFINER` RPC；常规读与单表更新走 PostgREST + 严格 RLS + Realtime；分 M1/M2/M3 三个里程碑真机验收 | 弱网下杜绝半成品脏数据；数据库层彻底保障匿名投票隐私与并发安全；每阶段皆可双机真实联调，无返工 | 前期需编写并执行 3 份结构化 SQL 迁移脚本，且 M1 即需准备好 Supabase 项目 |
| **方案 B：极简 SQL + 业务逻辑放前端编排** | 仅保留建表、基础 RLS 与进房 RPC，建房插模板、软删除记日志等多步写入在前端依次调用 | 业务流程集中在 TypeScript，少写 PL/pgSQL | 弱网中途中断易留残缺房间或漏记日志；客户端自插 `host` 成员增加 RLS 复杂度；匿名投票仍需数据库视图兜底 |
| **方案 C：本地 Mock 先行跑通 UI，后期接 Supabase** | 先用本地 Zustand/AsyncStorage 跑完全部页面与交互，最后统一替换为 Supabase + Realtime | 零后端准备即可最快在手机上看到全部界面 | 实时同步、RLS 权限、图片上传、双机门禁等核心难点延后至末尾暴露，重写数据层增加约 25% 重复工作量 |

**最终选定：方案 A**。理由是 PopRoom 的核心价值在于 3–20 人弱网实时协作与可靠门禁，将关键写操作原子化并尽早真机联调，整体返工最少，也为第二阶段接入聊天室与推送打牢底座。

---

## 5. 核心设计详解

> 说明：下文明确区分 **用户已确认决策** 与 **工程默认决策（我方代为敲定，审阅时可调整）**。

### 5.1 账号认证与个人资料
- **登录方式（用户已确认）**：邮箱 + 密码注册与登录（第一阶段在 Supabase Auth 关闭强制邮箱确认）；会话令牌使用 `expo-secure-store` 持久化。
- **首次引导（`app/(auth)/onboarding.tsx`）**：登录后若 `profiles` 表无记录，强制进入引导页填写 `nickname`（1–20 字符，必填）并从预设色盘选择 `avatar_color`；提交后写入 `profiles` 进入活动大厅。
- **路由守卫（`app/_layout.tsx`）**：未登录 → `/(auth)/login`；已登录但未建档 → `/(auth)/onboarding`；已登录且已建档 → 正常进入大厅或暂存的 Deep Link 进房页（若用户未登录时点击邀请链接，登录后自动跳转回对应 `room/join?code=XXXXXX`）*[工程默认决策]*。

### 5.2 统一 6 位房间码与两档门禁（用户已确认）
用全局唯一的 **6 位房间码（`room_code`）** 替代原文档中分离的 `invite_token`（12 位 hex）与 4 位数字 `passcode`：
- **编码规则**：采用去掉易混淆字符（`0/O/1/I`）的 32 字符集 `23456789ABCDEFGHJKLMNPQRSTUVWXYZ` 随机生成 6 位大写码（如 `K7M3P9`，组合空间约 10.7 亿），建房与重置时循环碰撞检测确保全局唯一，输入时自动忽略空格并转大写 *[工程默认决策]*。
- **统一入口**：大厅提供“输入 6 位房间码”底部抽屉；分享时同时生成可读口令文案与 Deep Link（`poproom://room/join?code=K7M3P9`，Expo Go 环境下由 `expo-linking` 自动适配链接前缀）。
- **两档门禁（`rooms.join_mode`）**：
  - `passcode`（凭码直进）：输入正确 `room_code` 直接以 `role='member', status='active'` 入房。
  - `approval`（凭码审批）：输入 `room_code` 并填写可选备注 `apply_note` 后写入 `status='pending'`，前端显示“等待房主审批”状态页（实时监听自身 `room_members` 行变更，审批通过后自动跳转进房）。
- **特殊状态处理** *[工程默认决策]*：
  - 已是 `active` 成员再次进房：直接返回 `room_id` 跳转入房。
  - 已被 `kicked` 的成员：服务端拒绝并返回 `USER_KICKED`。
  - 曾被 `rejected` 的申请人：在 `approval` 模式下允许重新提交申请（重置状态为 `pending` 并更新 `apply_note`）。
- **防扩散重置**：房主/管理员在设置页点击“重置房间码”调用 `reset_room_code` RPC，立刻生成新 6 位码，旧码与旧链接即刻失效，已入房成员不受任何影响。

### 5.3 数据库结构、RLS 与原子 RPC

SQL 拆分为 3 个顺序迁移文件，存放于 `supabase/migrations/`：

#### A. `001_initial_schema.sql`（核心表、索引与 Realtime）
- **`profiles`**：`id (UUID PK -> auth.users)`、`nickname`、`avatar_color`、`avatar_url`、`expo_push_token`（预留）、`created_at`、`updated_at`。
- **`rooms`**：`id`、`title`、`announcement`、`template_type ('campus'|'travel'|'party'|'custom')`、`event_start_at`、`event_end_at`、`join_mode ('passcode'|'approval')`、`room_code (TEXT UNIQUE NOT NULL)`、`chat_enabled (BOOLEAN DEFAULT FALSE，第二阶段预留)`、`allow_member_create_poll (BOOLEAN DEFAULT TRUE)`、`status ('active'|'archived')`、`archived_at`、`created_by`、`created_at`、`updated_at`。
- **`room_members`**：`id`、`room_id`、`user_id`、`role ('host'|'admin'|'member')`、`status ('pending'|'active'|'rejected'|'kicked')`、`apply_note`、`joined_at`、`UNIQUE(room_id, user_id)`。
- **`blocks`**：`id`、`room_id`、`type ('poll'|'task'|'schedule'|'expense')`、`title`、`sort_order`、`config (JSONB)`、`created_by`、`created_at`、`updated_at`。
- **`block_items`**：`id`、`block_id`、`room_id`（冗余用于按房间订阅 Realtime）、`data (JSONB)`、`sort_order`、`is_deleted (BOOLEAN DEFAULT FALSE)`、`created_by`、`created_at`、`updated_at`。
- **`poll_votes`（新增独立表，用户已确认）**：
  - `id (UUID PK)`、`room_id (UUID -> rooms)`、`block_id (UUID -> blocks)`、`item_id (UUID -> block_items)`、`user_id (UUID -> profiles)`、`created_at (TIMESTAMPTZ)`。
  - 唯一约束：`UNIQUE(item_id, user_id)`；索引：`(room_id, block_id)`、`(block_id, user_id)`。
- **`item_comments`**：`id`、`item_id`、`room_id`、`user_id`、`content`、`created_at`。
- **`activity_logs`**：`id`、`room_id`、`actor_id`、`action ('delete_item'|'restore_item'|'update_room'|'kick_member')`、`target_table`、`target_id`、`before_snapshot (JSONB)`、`restored_at (TIMESTAMPTZ NULL)`、`created_at`。
- **Realtime 发布**：将 `rooms`、`room_members`、`blocks`、`block_items`、`item_comments` 加入 `supabase_realtime`（**故意不将 `poll_votes` 直接暴露给客户端 Realtime**，避免匿名投票的 `user_id` 通过实时通道泄露；投票变更时由 `toggle_poll_vote` 同步刷新对应 `block_items.updated_at` 触发客户端增量拉取统计结果）。

#### B. `002_rls_policies.sql`（行级安全与存储策略）
- **辅助函数（`SECURITY DEFINER`, `SET search_path = public`）**：
  - `is_active_member(p_room_id UUID) RETURNS BOOLEAN`
  - `is_room_admin(p_room_id UUID) RETURNS BOOLEAN`（`role IN ('host', 'admin') AND status = 'active'`）
  - `is_room_host(p_room_id UUID) RETURNS BOOLEAN`
  - `is_room_active(p_room_id UUID) RETURNS BOOLEAN`（`status = 'active'`）
  - `is_poll_anonymous(p_block_id UUID) RETURNS BOOLEAN`
- **关键策略**：
  - `profiles`：本人可写；同房间活跃成员（或待审批申请人的房主/管理员）可读 `id/nickname/avatar_color/avatar_url`。
  - `rooms` / `blocks` / `block_items` / `item_comments`：仅 `is_active_member(room_id)` 可读；`room_members` 本人可读自己所在任意状态的行（支持待审批页订阅自身状态），活跃成员可读同房间成员列表。
  - **写操作归档只读锁**：所有业务表 `INSERT/UPDATE/DELETE` 策略一律附加 `is_room_active(room_id)`。
  - **条目编辑隔离**：`block_items` 的直接 `UPDATE` 策略仅允许 `is_room_active(room_id) AND (created_by = auth.uid() OR is_room_admin(room_id))`，防止普通成员误改他人创建的标题、日程或账单；多人并发协作高频动作（任务认领、认领人改状态与传实拍图、投票）全部走下述原子 RPC（`SELECT ... FOR UPDATE` 行锁更新），杜绝 JSONB 并发覆盖。
  - **硬删除禁止**：普通客户端策略禁止直接 `DELETE` `block_items`，统一走 `soft_delete_block_item` RPC；`poll_votes` 禁止客户端直接读写表，统一走 `toggle_poll_vote` 与 `get_room_poll_tallies` RPC（或仅允许 `SELECT` 自己的行与非匿名投票行），从根源杜绝匿名泄露与单选多投越权。
  - `activity_logs`：仅 `is_room_admin(room_id)` 可读，写入全部由服务端 RPC 完成。
  - **Storage 存储桶 `room-media`**（私有桶）：路径规范 `{room_id}/{block_type}/{item_id}/{uuid}.{ext}`，RLS 校验首段 `room_id` 满足 `is_active_member`（上传额外校验 `is_room_active`），单文件大小前端压缩后限制 5MB 以内 *[工程默认决策]*。

#### C. `003_rpcs.sql`（核心原子 RPC 清单）
所有 RPC 统一以 `SECURITY DEFINER` + `SET search_path = public` 编写，并在函数开头强制校验 `auth.uid()` 与房间状态：

| RPC 名称 | 权限要求 | 原子行为 |
| :--- | :--- | :--- |
| `create_room_with_template(...)` | 已建档登录用户 | 插入 `rooms`（生成唯一 6 位 `room_code`）→ 插入创建者为 `host`/`active` → 按模板批量插入预装 `blocks` → 返回房间记录 |
| `join_room_by_code(p_room_code, p_apply_note)` | 已建档登录用户 | 按大写房间码查房 → 校验未归档、未被踢 → 按 `join_mode` 写入或更新 `room_members`（`active` 或 `pending`）→ 返回 `{ room_id, status, title }` |
| `review_member_application(p_room_id, p_target_user_id, p_decision)` | `is_room_admin` + 房间活跃 | 将 `pending` 成员更新为 `active` 或 `rejected` |
| `update_member_role(p_room_id, p_target_user_id, p_role)` | `is_room_host` + 房间活跃 | 房主升降级成员为 `admin` 或 `member` *[工程默认决策]* |
| `kick_room_member(p_room_id, p_target_user_id)` | `is_room_admin` + 房间活跃 | 不可踢 `host`、`admin` 不可互踢 → 置为 `kicked` → 写入 `activity_logs` |
| `reset_room_code(p_room_id)` | `is_room_admin` + 房间活跃 | 生成新唯一 6 位 `room_code` 更新房间并返回 |
| `toggle_poll_vote(p_item_id)` | `is_active_member` + 房间活跃 | 校验所属 `poll` 未锁定且未过期 → 若单选则清除本人在该 `block_id` 的旧投票 → 切换 `poll_votes` 行 → 更新 `block_items.updated_at` 触发 Realtime → 返回该投票积木最新汇总 |
| `get_room_poll_tallies(p_room_id)` | `is_active_member` | 聚合返回房间内所有投票项的 `{ item_id, block_id, vote_count, my_voted, voter_ids }`；若 `anonymous = true`，`voter_ids` 强制返回空数组 `[]` |
| `toggle_task_claim(p_item_id)` | `is_active_member` + 房间活跃 | 对任务行加行锁（`FOR UPDATE`），原子增删 `auth.uid()` 于 `data.assigneeIds`；认领 `unclaimed` 任务自动转为 `in_progress`，取消最后一个认领人且当前为 `in_progress` 时回退为 `unclaimed` *[工程默认决策]* |
| `set_task_status(p_item_id, p_status)` | 房间活跃 +（当前认领人 / 创建者 / `is_room_admin`） | 行锁校验权限后原子更新 `data.status`（`unclaimed` / `in_progress` / `done`）*[工程默认决策]* |
| `update_task_images(p_item_id, p_image_urls)` | 房间活跃 +（当前认领人 / 创建者 / `is_room_admin`） | 校验最多 3 张图片 URL 后原子更新 `data.imageUrls` *[工程默认决策]* |
| `soft_delete_block_item(p_item_id)` | 房间活跃 +（创建者或 `is_room_admin`） | 置 `block_items.is_deleted = true` → 将删除前快照写入 `activity_logs (action='delete_item')` |
| `restore_deleted_item(p_log_id)` | `is_room_admin` + 房间活跃 | 将对应 `block_items.is_deleted` 还原为 `false`，标记日志 `restored_at = NOW()` 并追加 `restore_item` 记录 |
| `archive_room(p_room_id)` | `is_room_host` + 房间活跃 | 置 `rooms.status = 'archived'`、`archived_at = NOW()` |

### 5.4 四大积木与 Zod 数据契约（`src/schemas/blocks.ts`）

所有 `blocks.config` 与 `block_items.data` 的前后端读写必须经过 Zod 解析，严格禁用 `any`：

1. **智能投票积木 (`poll`)**
   - `PollConfigSchema`：`mode ('option' | 'availability')`、`multiple`、`anonymous`、`allowAddOption`、`deadline (ISO | null)`、`isLocked`、`candidateDates?`、`timeSlots? ('morning'|'afternoon'|'evening')[]`。
   - `PollItemDataSchema`：`{ label: string, slotDate?: string, slotPeriod?: 'morning'|'afternoon'|'evening' }`（**已移除 `voterIds`**，投票状态由 `get_room_poll_tallies` 提供）。
   - **交互**：`option` 模式支持进度条比例展示、新增选项（受 `allowAddOption` 控制）、房主锁定/解锁投票；`availability` 模式以“日期 × 上午/下午/晚上”矩阵展示热力图，按得票人数与总活跃成员占比着色，自动高亮最多人有空的 Top 时段。
2. **分工与物资认领积木 (`task`)**
   - `TaskConfigSchema`：`{ allowMemberCreate: boolean }`。
   - `TaskItemDataSchema`：`{ title, description, status: 'unclaimed' | 'in_progress' | 'done', assigneeIds: uuid[], dueAt: ISO | null, imageUrls: string[] (max 3) }`。
   - **交互**：卡片右上角一键“认领/取消认领”（调用 `toggle_task_claim` RPC，自动维护 `assigneeIds` 与 `unclaimed ↔ in_progress` 流转）；当前认领人、任务创建者及房主/管理员可一键切换完成状态（`set_task_status`）并在详情底部抽屉中上传/管理最多 3 张实拍图（存 `room-media`，调用 `update_task_images`）；全体活跃成员均可发表和查看 `item_comments` 轻评论。
3. **可视化日程轴积木 (`schedule`)**
   - `ScheduleConfigSchema`：`{ groupBy: 'day' | 'phase' }`。
   - `ScheduleItemDataSchema`：`{ groupLabel, startTime, endTime?, title, locationName?, latitude?, longitude?, ownerId: uuid | null, notes }`。
   - **地点与导航（用户已确认）**：按 `groupLabel` 分组并按时间顺序渲染纵向时间轴；第一阶段新建日程仅填写纯文本 `locationName`（`latitude`/`longitude` 保留为可选字段供后续扩展，第一阶段不接入第三方地图 POI 搜索 API 与坐标系转换）。有 `locationName` 时展示“导航”按钮，点击弹出底部选择器，通过关键词 URL Scheme 唤起高德 / 百度 / Apple Maps / 浏览器地图，并附带“复制地点”兜底；依赖 TanStack Query 离线持久化确保野外/无信号场景只读可用。
4. **经费与智能分账积木 (`expense`)**
   - `ExpenseConfigSchema`：`{ mode: 'budget' | 'split', totalBudget: number | null, currency: 'CNY' }`。
   - `ExpenseItemDataSchema`：`{ title, amount (> 0), paidByUserId, participantIds (min 1), receiptUrl: string | null, spentAt: ISO }`。
   - **AA 最小转账算法（`src/lib/splitAlgorithm.ts`）**：
     1. 每笔金额统一以 `Math.round(amount * 100)` 转为整数“分”。
     2. 垫付人余额 `+amountCents`；每位分摊人扣减 `Math.floor(amountCents / n)`，余数 `r = amountCents % n` 按 `participantIds` 顺序各多分摊 1 分（保证所有成员净余额之和严格为 `0`）。
     3. 分为应收组（`> 0`）与应付组（`< 0`），按绝对值降序排列，双指针贪心匹配结算 `min(|应付|, 应收)`，输出 `{ fromUserId, toUserId, amountCents }[]`。
   - **交互**：`budget` 模式顶部展示“总预算 / 已支出 / 剩余预算”进度条与支出流水；`split` 模式顶部展示个人净应收应付卡片与“最少转账方案”清单；支持上传小票凭证图。

### 5.5 场景预设模板（`src/lib/templates.ts`）
| 模板标识 | 名称 | 预装积木（默认顺序） |
| :--- | :--- | :--- |
| `campus` | 校园 / 社团活动 | 时间投票（`availability`）→ 分工与物资认领 → 活动当天日程轴 → 社团预算报销（`budget`） |
| `travel` | 多人出游 / 野营 | 方案/目的地投票（`option`）→ 每日行程轴 → 行李物资分工 → AA 分账器（`split`） |
| `party` | 聚餐 / 团建 | 时间与餐厅投票（`option`）→ 费用 AA 分账（`split`） |
| `custom` | 空白自定义 | 不预装，进入后点击底部“添加积木”自由拼装 |

*(第一阶段所有模板默认 `chat_enabled = false`，待第二阶段接入聊天室 UI 后恢复模板差异化默认开关。)*

### 5.6 角色权限矩阵（`src/hooks/useRoomPermissions.ts`）*[工程默认决策]*

| 能力 | 房主 (`host`) | 管理员 (`admin`) | 普通成员 (`member`) | 归档后（全员） |
| :--- | :---: | :---: | :---: | :---: |
| 查看积木与条目、导出复盘 | ✅ | ✅ | ✅ | ✅ |
| 投票、认领/取消认领任务、发表条目评论 | ✅ | ✅ | ✅ | ❌ |
| 标记任务完成、上传/删除任务实拍图 | ✅ | ✅ | 仅本人认领或创建的任务 | ❌ |
| 新增/排序/删除积木、锁定投票 | ✅ | ✅ | ❌（仅 `allow_member_create_poll` 时可新建投票） | ❌ |
| 新建条目（任务/日程/账单/投票项） | ✅ | ✅ | ✅（受积木开关约束） | ❌ |
| 编辑/软删除条目（标题/描述/日程/账单等） | ✅ | ✅ | 仅本人创建条目 | ❌ |
| 审批入房、踢普通成员、重置房间码 | ✅ | ✅ | ❌ | ❌ |
| 查看操作日志与一键恢复删除条目 | ✅ | ✅ | ❌ | 只读查看 |
| 升降级管理员、手动归档房间 | ✅ | ❌ | ❌ | ❌ |

### 5.7 页面结构与复盘导出
保留 `app.md` 简洁的双 Tab 结构，第一阶段落地页面如下：
- `app/(auth)/login.tsx`、`app/(auth)/onboarding.tsx`
- `app/(tabs)/index.tsx`（活动大厅：进行中卡片流 + 折叠已归档区 + 建房 / 输 6 位码进房）
- `app/(tabs)/profile.tsx`（个人中心：修改昵称与色块头像、已归档活动入口、退出登录）
- `app/room/create.tsx`（4 套模板选择 + 标题/时间/公告 + 两档门禁）
- `app/room/join.tsx`（6 位房间码输入 / 邀请链接落地页 + 审批等待实时页）
- `app/room/[id]/index.tsx`（房间协作看板主视图：归档只读横幅、四大积木列表、添加积木底部抽屉、顶部跳转设置/导出；第一阶段无聊天室 Tab）
- `app/room/[id]/settings.tsx`（房间公告与基本信息编辑、6 位房间码展示/复制/重置、门禁切换、待审批申请列表、成员列表与权限/踢人、进入操作日志、手动归档按钮）
- `app/room/[id]/logs.tsx`（操作日志时间线 + 已软删除条目的“一键恢复”按钮）
- `app/room/[id]/export.tsx`（汇总房间标题与活动时间、各投票最高票结论、分工完成率与明细、完整日程轴、总支出与 AA 结算转账清单；提供“导出高清长图”`react-native-view-shot` 与“导出 PDF”`expo-print`，通过 `expo-sharing` 分享或保存）

### 5.8 视觉基调 *[工程默认决策]*
围绕“轻橘 PopRoom”品牌感采用温暖清爽的浅色卡片风：主色轻橘橙 `#F97316`、浅橘背景点缀 `#FFF7ED`、页面浅灰底 `#F8FAFC`、纯白圆角卡片搭配细描边与明确的状态徽章，突出移动端单手可读性与轻快节奏。

---

## 6. 交给后续计划与实现阶段决定的细节

以下内容不改变产品行为，留给实现计划与编码阶段按最佳实践落定：
- 原子 UI 组件（`Button`、`Card`、`Avatar`、`Badge`、`BottomSheet` 包装器）的细粒度 props、间距、字号和微动效；
- 空状态文案与图标选择、下拉刷新与错误提示 Toast 样式；
- `useRoomRealtime.ts` 的具体 channel 生命周期管理与断网重连防抖策略；
- 图片前端压缩分辨率与签名 URL 缓存时长；
- 单元测试运行器配置（Jest / Vitest）与目录组织。

---

## 7. 分阶段实施里程碑（均可在 Expo Go 真机验收）

1. **M1：工程骨架、Supabase 底座与进房门禁闭环**
   - 初始化 Expo Router + TypeScript Strict + NativeWind v4 + TanStack Query（含 AsyncStorage 持久化）+ Zustand 工程。
   - 编写并执行 `001_initial_schema.sql`、`002_rls_policies.sql`、`003_rpcs.sql` 及 `room-media` 存储桶配置。
   - 完成邮箱密码登录、首次昵称/头像引导、活动大厅、4 套模板建房、6 位房间码与 Deep Link 进房、房主审批/踢人/重置房间码。
   - **验收标准**：两台手机分别注册账号，A 建房（分别测试直进与审批两种模式），B 通过 6 位码或链接进房，A 可审批/踢人/重置房间码。

2. **M2：四大协作积木、实时同步与防手滑回滚**
   - 完成 `src/schemas/blocks.ts`、`src/lib/splitAlgorithm.ts`（含单元测试）与 `useRoomRealtime.ts`。
   - 依次完成 `PollBlock`（含空闲热力图与匿名投票隐私校验）、`TaskBlock`（认领流转 + 实拍图上传 + 轻评论）、`ScheduleBlock`（日程轴 + 外部地图唤起 + 断网可读）、`ExpenseBlock`（预算与 AA 分账双模式）。
   - 完成 `logs.tsx` 操作日志与房主一键恢复软删除条目。
   - **验收标准**：两台手机同时在房间内投票、认领任务、增删日程与记账，实时同步无冲突；匿名投票不泄露投票人；误删条目可一键还原。

3. **M3：归档只读锁、复盘导出与真机体验打磨**
   - 完成房主手动归档与数据库/前端双层只读校验。
   - 完成 `export.tsx` 复盘汇总、高清长图导出、PDF 导出与系统分享。
   - 补全弱网乐观更新回滚提示、离线只读验证与端到端真机验收清单。
   - **验收标准**：归档后房间自动进入大厅折叠归档区，全员无法修改任何数据，但可正常查看并导出清晰完整的活动复盘长图与 PDF。
