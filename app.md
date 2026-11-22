# 临时性多人协作 App 轻橘 PopRoom（MVP）开发规范文档

## 1. 项目总览与技术栈

### 1.1 产品定位
一款面向校园社团、班级活动、朋友出游与小型聚会的轻量化独立协作 App。核心理念为**“一件事一个房间，协作优先、沟通为辅、用完即归档”**。

### 1.2 锁定技术栈
* **前端框架**：Expo (SDK 52+) + React Native + Expo Router (文件路由) + TypeScript (Strict Mode)
* **样式与 UI**：NativeWind v4 (Tailwind CSS) + `lucide-react-native` (图标) + `@gorhom/bottom-sheet` (移动端底部抽屉)
* **状态与缓存**：TanStack Query v5 (数据请求、乐观更新、AsyncStorage 离线持久化) + Zustand (全局轻状态)
* **后端与实时通信**：Supabase (PostgreSQL + Auth + Realtime + Storage + Edge Functions)
* **数据校验**：Zod (严格约束所有 `JSONB` 结构与表单输入)
* **消息推送与导航**：`expo-notifications` + `expo-linking` (深度链接与外部地图唤起)
* **导出工具**：`react-native-view-shot` (导出复盘长图) + `expo-print` (导出 PDF)

### 1.3 AI 编码铁律（执行前必读）
1. **严格类型安全**：禁止使用 `any`；所有 `blocks.config` 与 `block_items.data` 的读写必须经过 `src/schemas/blocks.ts` 中的 Zod 校验。
2. **移动端单手体验**：高频操作（投票、认领任务、记账、新建条目）统一使用底部抽屉（BottomSheet）完成，避免复杂的多级表单跳转和横向滚动大表格。
3. **乐观更新优先**：投票勾选、任务认领、发送消息必须先更新本地 Query Cache，再异步落库，确保弱网环境下 0 延迟反馈。
4. **安全边界**：所有进房校验（口令验证、申请审批）必须通过 Supabase RPC 函数在服务端完成，严禁在客户端直接查询未加入房间的敏感字段。

---

## 2. 项目目录结构规划

```text
project-root/
├── app/                              # Expo Router 路由目录
│   ├── _layout.tsx                   # 根布局（QueryClient、Auth 守卫、DeepLink 监听）
│   ├── (auth)/
│   │   ├── login.tsx                 # 一键登录 / Apple 登录（预留微信/QQ入口）
│   │   └── onboarding.tsx            # 首次登录填写昵称与选择色块头像
│   ├── (tabs)/
│   │   ├── _layout.tsx               # 底部导航（仅 2 个 Tab：活动、我的）
│   │   ├── index.tsx                 # 活动大厅（进行中卡片流 + 折叠归档区 + 建房/口令入口）
│   │   └── profile.tsx               # 个人中心（通知列表、账号管理、历史归档导出）
│   ├── room/
│   │   ├── create.tsx                # 模板建房页（4套模板 + 门禁设置 + 聊天室开关）
│   │   ├── join.tsx                  # 邀请链接落地页 / 口令输入与等待审批页
│   │   └── [id]/
│   │       ├── index.tsx             # 协作房间主页面（顶部 Tab：协作看板 | 聊天室）
│   │       ├── settings.tsx          # 房主设置（成员审批、重置口令/链接、开关聊天室、归档）
│   │       ├── logs.tsx              # 操作日志与一键回滚页（房主/管理员可见）
│   │       └── export.tsx            # 活动复盘长图 / PDF 预览与导出页
├── src/
│   ├── components/
│   │   ├── ui/                       # 基础原子组件（Button、Card、Avatar、Badge、Drawer）
│   │   ├── blocks/                   # 四大积木独立组件
│   │   │   ├── PollBlock.tsx         # 方案投票 + 空闲时间热力图投票
│   │   │   ├── TaskBlock.tsx         # 分工认领 + 状态流转 + 实拍图 + 轻评论
│   │   │   ├── ScheduleBlock.tsx     # 可视化日程轴 + 一键唤起地图导航
│   │   │   └── ExpenseBlock.tsx      # 社团预算报销 / AA 最小转账分账双模式
│   │   └── chat/
│   │       ├── ChatRoomView.tsx      # 轻量聊天室（支持 @提及、长按转积木、举报/屏蔽）
│   │       └── BlockReminderCard.tsx # 积木催办互动卡片
│   ├── lib/
│   │   ├── supabase.ts               # Supabase 客户端初始化
│   │   ├── splitAlgorithm.ts         # AA 最小转账次数结算算法
│   │   ├── templates.ts              # 4 套场景预设模板配置
│   │   └── notifications.ts          # 推送权限与 4 类协作 + @提及推送触发器
│   ├── hooks/
│   │   ├── useRoomRealtime.ts        # 监听房间积木、条目、成员与聊天室的实时变更
│   │   └── useRoomPermissions.ts     # 统一封装房主/管理员/成员/归档只读权限判断
│   └── schemas/
│       └── blocks.ts                 # 四大积木与聊天消息的 Zod 数据契约
└── supabase/
    └── migrations/
        └── 001_initial_schema.sql    # 核心建表、索引、RPC 与 RLS 策略
```

---

## 3. 数据库设计（Supabase PostgreSQL）

将以下 SQL 直接在 Supabase SQL Editor 中执行。设计包含：**用户资料、两档门禁（口令/审批）、四大积木、条目轻评论、可控聊天室、内容合规（举报/屏蔽）与操作日志**。

```sql
-- 启用必要扩展
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ==========================================
-- 1. 用户基础资料表（绑定 Supabase Auth）
-- ==========================================
CREATE TABLE profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  nickname TEXT NOT NULL,
  avatar_color TEXT NOT NULL DEFAULT '#3B82F6',
  avatar_url TEXT,
  expo_push_token TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ==========================================
-- 2. 协作房间表
-- ==========================================
CREATE TABLE rooms (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title TEXT NOT NULL,
  announcement TEXT DEFAULT '',
  template_type TEXT NOT NULL DEFAULT 'custom', -- 'campus' | 'travel' | 'party' | 'custom'
  event_start_at TIMESTAMPTZ,
  event_end_at TIMESTAMPTZ,
  
  -- 两档安全门禁（已移除锁房，改为随时重置 invite_token / passcode）
  join_mode TEXT NOT NULL DEFAULT 'passcode' CHECK (join_mode IN ('passcode', 'approval')),
  invite_token TEXT UNIQUE NOT NULL DEFAULT encode(gen_random_bytes(6), 'hex'),
  passcode TEXT NOT NULL DEFAULT lpad(floor(random() * 10000)::text, 4, '0'),
  
  -- 房主可控开关
  chat_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  allow_member_create_poll BOOLEAN NOT NULL DEFAULT TRUE,
  
  -- 生命周期状态（活动结束 7 天后自动转为 archived）
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'archived')),
  archived_at TIMESTAMPTZ,
  
  created_by UUID NOT NULL REFERENCES profiles(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ==========================================
-- 3. 房间成员与审批状态表
-- ==========================================
CREATE TABLE room_members (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  room_id UUID NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  role TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('host', 'admin', 'member')),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('pending', 'active', 'rejected', 'kicked')),
  apply_note TEXT, -- 审批模式下的入房备注
  joined_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (room_id, user_id)
);

CREATE INDEX idx_room_members_user ON room_members(user_id, status);
CREATE INDEX idx_room_members_room ON room_members(room_id, status);

-- ==========================================
-- 4. 积木模块表
-- ==========================================
CREATE TABLE blocks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  room_id UUID NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  type TEXT NOT NULL CHECK (type IN ('poll', 'task', 'schedule', 'expense')),
  title TEXT NOT NULL,
  sort_order INT NOT NULL DEFAULT 0,
  config JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_by UUID REFERENCES profiles(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_blocks_room ON blocks(room_id, sort_order);

-- ==========================================
-- 5. 积木条目表（投票项 / 任务 / 日程 / 账单）
-- ==========================================
CREATE TABLE block_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  block_id UUID NOT NULL REFERENCES blocks(id) ON DELETE CASCADE,
  room_id UUID NOT NULL REFERENCES rooms(id) ON DELETE CASCADE, -- 冗余字段，用于按房间订阅 Realtime
  data JSONB NOT NULL,
  sort_order INT NOT NULL DEFAULT 0,
  is_deleted BOOLEAN NOT NULL DEFAULT FALSE, -- 软删除，支持房主日志一键回滚
  created_by UUID REFERENCES profiles(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_block_items_room ON block_items(room_id, block_id) WHERE is_deleted = FALSE;

-- ==========================================
-- 6. 条目级轻量评论表
-- ==========================================
CREATE TABLE item_comments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  item_id UUID NOT NULL REFERENCES block_items(id) ON DELETE CASCADE,
  room_id UUID NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  content TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ==========================================
-- 7. 房间轻量聊天室消息表
-- ==========================================
CREATE TABLE room_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  room_id UUID NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  sender_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  msg_type TEXT NOT NULL DEFAULT 'text' CHECK (msg_type IN ('text', 'block_card', 'system')),
  content TEXT NOT NULL,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb, -- 存 @提及用户 ID 列表、关联积木卡片 ID 等
  is_deleted BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_room_messages_room ON room_messages(room_id, created_at DESC);

-- ==========================================
-- 8. 应用商店合规：举报与屏蔽表
-- ==========================================
CREATE TABLE message_reports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  message_id UUID NOT NULL REFERENCES room_messages(id) ON DELETE CASCADE,
  reporter_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  reason TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE user_blocks (
  blocker_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  blocked_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (blocker_id, blocked_id)
);

-- ==========================================
-- 9. 操作日志表（支持防手滑回滚）
-- ==========================================
CREATE TABLE activity_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  room_id UUID NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  actor_id UUID REFERENCES profiles(id) ON DELETE SET NULL,
  action TEXT NOT NULL, -- 'delete_item' | 'update_item' | 'update_room' | 'kick_member'
  target_table TEXT NOT NULL,
  target_id UUID NOT NULL,
  before_snapshot JSONB, -- 回滚所需快照
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ==========================================
-- 10. 开启 Realtime 订阅
-- ==========================================
ALTER PUBLICATION supabase_realtime ADD TABLE rooms, room_members, blocks, block_items, item_comments, room_messages;

-- ==========================================
-- 11. 核心安全 RPC：验证口令 / 提交入房申请
-- ==========================================
CREATE OR REPLACE FUNCTION join_room_by_invite(
  p_invite_token TEXT,
  p_passcode TEXT DEFAULT NULL,
  p_apply_note TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_room rooms%ROWTYPE;
  v_user_id UUID := auth.uid();
  v_existing room_members%ROWTYPE;
  v_new_status TEXT;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'NOT_AUTHENTICATED';
  END IF;

  SELECT * INTO v_room FROM rooms WHERE invite_token = p_invite_token;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'ROOM_NOT_FOUND';
  END IF;

  IF v_room.status = 'archived' THEN
    RAISE EXCEPTION 'ROOM_ARCHIVED';
  END IF;

  -- 检查是否已在房间内或被踢出
  SELECT * INTO v_existing FROM room_members WHERE room_id = v_room.id AND user_id = v_user_id;
  IF FOUND THEN
    IF v_existing.status = 'kicked' THEN
      RAISE EXCEPTION 'USER_KICKED';
    END IF;
    RETURN jsonb_build_object('room_id', v_room.id, 'status', v_existing.status);
  END IF;

  -- 校验门禁规则
  IF v_room.join_mode = 'passcode' THEN
    IF p_passcode IS NULL OR p_passcode <> v_room.passcode THEN
      RAISE EXCEPTION 'INVALID_PASSCODE';
    END IF;
    v_new_status := 'active';
  ELSE
    -- approval 模式：提交申请进入 pending 待审批状态
    v_new_status := 'pending';
  END IF;

  INSERT INTO room_members (room_id, user_id, role, status, apply_note)
  VALUES (v_room.id, v_user_id, 'member', v_new_status, p_apply_note);

  RETURN jsonb_build_object('room_id', v_room.id, 'status', v_new_status);
END;
$$;
```

### RLS（行级安全策略）实现要点
AI 在生成 `002_rls_policies.sql` 时，必须遵循以下原则：
* 封装辅助函数 `is_active_member(p_room_id UUID)` 与 `is_room_admin(p_room_id UUID)`。
* **`rooms` / `blocks` / `block_items` / `item_comments` / `room_messages`**：仅允许 `is_active_member(room_id)` 读取。
* **归档只读锁**：所有 `INSERT / UPDATE / DELETE` 策略均须附加条件 `EXISTS (SELECT 1 FROM rooms WHERE id = room_id AND status = 'active')`，从数据库底层保证归档后不可篡改。
* **聊天室读取过滤**：查询 `room_messages` 时自动过滤 `is_deleted = FALSE` 且 `sender_id NOT IN (SELECT blocked_id FROM user_blocks WHERE blocker_id = auth.uid())`。

---

## 4. 四大积木与聊天室 Zod 数据契约

文件位置：`src/schemas/blocks.ts`。所有前端表单和服务端 JSONB 存储均以此文件为唯一真相源（Single Source of Truth）：

```typescript
import { z } from 'zod';

// ==========================================
// 1. 智能投票积木 (poll)
// ==========================================
export const PollConfigSchema = z.object({
  mode: z.enum(['option', 'availability']), // 方案投票 | 空闲时间热力图
  multiple: z.boolean().default(false),
  anonymous: z.boolean().default(false),
  allowAddOption: z.boolean().default(true),
  deadline: z.string().datetime().nullable().default(null),
  isLocked: z.boolean().default(false),
  // 空闲时间模式专属：候选日期与时段
  candidateDates: z.array(z.string()).optional(), // ['2026-11-28', '2026-11-29']
  timeSlots: z.array(z.enum(['morning', 'afternoon', 'evening'])).optional(),
});

export const PollItemDataSchema = z.object({
  label: z.string().min(1),                 // 选项文本，或 '2026-11-28_afternoon'
  voterIds: z.array(z.string().uuid()).default([]),
});

// ==========================================
// 2. 分工与物资认领积木 (task)
// ==========================================
export const TaskConfigSchema = z.object({
  allowMemberCreate: z.boolean().default(true),
});

export const TaskItemDataSchema = z.object({
  title: z.string().min(1),
  description: z.string().default(''),
  status: z.enum(['unclaimed', 'in_progress', 'done']).default('unclaimed'),
  assigneeIds: z.array(z.string().uuid()).default([]), // 空数组表示待公开认领
  dueAt: z.string().datetime().nullable().default(null),
  imageUrls: z.array(z.string().url()).max(3).default([]),
});

// ==========================================
// 3. 可视化日程轴积木 (schedule)
// ==========================================
export const ScheduleConfigSchema = z.object({
  groupBy: z.enum(['day', 'phase']).default('day'),
});

export const ScheduleItemDataSchema = z.object({
  groupLabel: z.string().default('活动当天'), // 如 '第 1 天' 或 '筹备期'
  startTime: z.string(),                      // ISO 时间或 '09:00'
  endTime: z.string().optional(),
  title: z.string().min(1),
  locationName: z.string().optional(),
  latitude: z.number().optional(),            // 用于一键唤起地图导航
  longitude: z.number().optional(),
  ownerId: z.string().uuid().nullable().default(null),
  notes: z.string().default(''),
});

// ==========================================
// 4. 经费与智能分账积木 (expense)
// ==========================================
export const ExpenseConfigSchema = z.object({
  mode: z.enum(['budget', 'split']),          // 社团预算报销 | AA 分账
  totalBudget: z.number().nonnegative().nullable().default(null),
  currency: z.string().default('CNY'),
});

export const ExpenseItemDataSchema = z.object({
  title: z.string().min(1),
  amount: z.number().positive(),              // 单位：元（计算时统一转为分避免浮点误差）
  paidByUserId: z.string().uuid(),
  participantIds: z.array(z.string().uuid()).min(1), // 参与分摊成员
  receiptUrl: z.string().url().nullable().default(null),
  spentAt: z.string().datetime(),
});

// ==========================================
// 5. 聊天室消息元数据 (room_messages.metadata)
// ==========================================
export const ChatMessageMetadataSchema = z.object({
  mentionAll: z.boolean().default(false),
  mentionUserIds: z.array(z.string().uuid()).default([]),
  linkedBlockId: z.string().uuid().optional(),
  linkedItemId: z.string().uuid().optional(),
  linkedBlockType: z.enum(['poll', 'task', 'schedule', 'expense']).optional(),
  linkedTitle: z.string().optional(),
});
```

### AA 最小转账次数算法规范（`src/lib/splitAlgorithm.ts`）
1. 所有金额乘以 `100` 转为整数“分”进行运算，防止 JS 浮点数精度丢失。
2. 遍历每笔账单：垫付人余额加 `amount`，每个 `participantIds` 成员余额减 `Math.floor(amount / n)`（余数按顺序分配给前几位或记入垫付人）。
3. 将所有成员拆分为**应收组（余额大于 0）**与**应付组（余额小于 0）**，各自按绝对值降序排列。
4. 使用双指针贪心匹配：每次取最大应付人与最大应收人结算 `min(|应付|, 应收)`，生成一条 `{ fromUserId, toUserId, amountCents }` 记录，直到双方归零。

---

## 5. 核心页面交互与业务流设计

### 5.1 场景预设模板（`src/lib/templates.ts`）
创建房间时，根据用户选择的模板自动批量插入对应 `blocks`：

| 模板标识 | 预装积木（按默认顺序） | 默认聊天室开关 |
| :--- | :--- | :---: |
| `campus`（校园/社团活动） | 时间投票 → 分工与物资认领 → 活动当天日程轴 → 社团预算报销 | 开启 |
| `travel`（多人出游） | 方案/目的地投票 → 每日行程轴 → 行李物资分工 → AA 分账器 | 开启 |
| `party`（聚餐/团建） | 时间与餐厅投票 → 费用 AA 分账 | 关闭 |
| `custom`（空白自定义） | 不预装，进入后点击底部“添加积木”自由拼装 | 关闭 |

### 5.2 房间核心交互规范（`app/room/[id]/index.tsx`）
* **默认落脚点**：进入房间默认高亮显示 **`协作看板`** Tab；当 `rooms.chat_enabled === true` 时，顶部显示双 Tab 切换器（`协作看板` | `聊天室`），聊天室有未读消息时仅在 Tab 右上角展示数字红点。
* **聊天 ↔ 积木双向联动**：
  * **聊完转积木**：在聊天室长按任意文本消息，底部弹出操作菜单：`转为分工任务`、`加入日程轴`、`复制`、`举报`、`屏蔽此人`（房主额外可见 `删除消息`）。点击转换后，预填该消息文本直接唤起对应积木的新建抽屉。
  * **积木催办卡片**：房主点击投票/分工卡片右上角“发送到聊天室提醒”，插入一条 `msg_type = 'block_card'` 的消息，成员在聊天室内点击该卡片直接滚动并高亮对应积木完成操作。
* **防扩散刷新机制**：房主在 `settings.tsx` 点击“重置口令与邀请链接”时，服务端更新 `rooms.invite_token` 与 `rooms.passcode`，旧链接立即失效，已入房成员不受任何影响。

### 5.3 推送触发规则（克制不打扰）
通过 Supabase Database Webhooks 调用 Edge Function 向 `expo_push_token` 发送推送，**仅限以下 5 种事件**：
1. 协作事件：发起新投票、被指派新任务、认领任务截止前 2 小时、活动开始前 2 小时集合提醒（点击通知直接唤起对应日程项）。
2. 聊天事件：仅当 `metadata.mentionUserIds` 包含当前用户，或房主触发 `metadata.mentionAll === true` 时发送推送；普通消息绝不弹窗。
3. 门禁事件：审批模式下有新成员申请入房，向房主推送“XX 申请加入房间”。

---

## 6. 分阶段 AI 开发执行清单

将本文件交给 AI 编程工具时，**不要一次性要求生成整个项目**，请严格按以下 5 个阶段分批下达指令，每完成一个阶段在手机真机（Expo Go）验证通过后再进入下一阶段：

### Phase 1：工程骨架、认证与数据库初始化
* 初始化 Expo Router + TypeScript + NativeWind v4 + TanStack Query 工程。
* 执行 `001_initial_schema.sql` 与 `002_rls_policies.sql`，配置 `src/lib/supabase.ts`（集成 `expo-secure-store` 持久化会话）。
* 实现 `(auth)/login.tsx`（MVP 阶段先跑通邮箱/手机验证码或 Apple 登录，预留一键登录接口）与 `onboarding.tsx` 昵称/色块头像设置页。

### Phase 2：活动大厅、模板建房与两档安全门禁
* 实现 `(tabs)/index.tsx` 活动大厅（展示进行中卡片 + 折叠已归档卡片）。
* 实现 `room/create.tsx`（4 套模板自动建房 + 两档门禁 + 聊天室开关）。
* 实现 `room/join.tsx` 与 Deep Link 配置，调用 `join_room_by_invite` RPC；实现房主在 `settings.tsx` 中审批入房申请、移除成员、重置口令/邀请链接。

### Phase 3：四大协作积木与实时同步
* 实现 `src/schemas/blocks.ts` 与 `useRoomRealtime.ts`。
* 依次完成 `PollBlock`（含热力图投票）、`TaskBlock`（含图片上传至 Supabase Storage 与条目轻评论）、`ScheduleBlock`（含地图导航唤起与离线缓存）、`ExpenseBlock`（含 `splitAlgorithm.ts` 单元测试）。
* 实现 `logs.tsx` 操作日志记录与房主一键撤销软删除条目。

### Phase 4：房主可控聊天室与合规闭环
* 在 `room/[id]/index.tsx` 集成顶部 `协作看板 | 聊天室` Tab 切换（受 `chat_enabled` 控制）。
* 实现 `ChatRoomView.tsx`：实时收发、未读角标、`@成员` 选择器、长按消息转分工/日程、积木卡片一键催办。
* 实现合规三件套：房主删消息、长按举报写入 `message_reports`、拉黑写入 `user_blocks` 并即时隐藏对方发言。

### Phase 5：精准推送、自动归档与复盘导出
* 集成 `expo-notifications` 上报 Push Token，编写 Edge Function 处理 5 类精准推送与 Deep Link 跳转。
* 配置 Supabase `pg_cron` 定时任务，每日扫描并将 `event_end_at` 已超过 7 天的房间自动更新为 `status = 'archived'`。
* 实现 `room/[id]/export.tsx`，汇总最终日程、分工完成率与费用结算明细，支持一键导出高清长图或 PDF。