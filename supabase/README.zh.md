# 轻橘 PopRoom Supabase 配置指南（第一阶段 + 第二阶段）

[English](./README.md) | 简体中文

按以下步骤在一个全新的 Supabase 项目中完成初始化（或从第一阶段平滑升级至第二阶段），配置 PostgreSQL 表结构、行级安全策略（RLS）、私有存储桶 `room-media`、Realtime 实时发布、原子 RPC 函数以及 7 天 `pg_cron` 自动归档定时任务。

## 1. 创建 Supabase 项目

1. 登录 [Supabase 控制台](https://supabase.com/dashboard)，点击 **New Project**。
2. 选择所属组织、填写项目名称（例如 `poproom-mvp`）、设置强数据库密码，并选择离你最近的区域（Region）。
3. 等待数据库初始化完成。

## 2. 开启 `pg_cron` 扩展（建议在执行 `005` 前完成）

第二阶段新增 7 天自动归档定时任务（`poproom-auto-archive-daily`，每日 UTC `0 19 * * *` / 北京时间凌晨 03:00 执行）。如需在运行 `005` 时自动注册定时任务：

1. 在 Supabase 控制台中进入 **Database** → **Extensions**。
2. 搜索 **`pg_cron`** 并将其开关切换为 **ON**（开启）。
3. 等待扩展启用完成后，再执行 `005_stage2_rpcs_and_auto_archive.sql`。

> 提示：`005_stage2_rpcs_and_auto_archive.sql` 内置了 `pg_cron` 存在性检查与同名任务幂等清理逻辑。若后续才开启 `pg_cron`，在 **SQL Editor** 中重新执行一次 `005` 即可安全注册每日自动归档任务。

## 3. 按顺序执行数据库迁移脚本（`001` → `002` → `003` → `004` → `005`）

在 Supabase 项目控制台中打开 **SQL Editor**，严格按以下先后顺序执行迁移脚本（已完成第一阶段部署的项目只需增量执行 `004` 和 `005`）：

1. `supabase/migrations/001_initial_schema.sql`
   - 创建第一阶段 8 张核心数据表（`profiles`、`rooms`、`room_members`、`blocks`、`block_items`、`poll_votes`、`item_comments`、`activity_logs`）、索引与触发器，并为 `rooms`、`room_members`、`blocks`、`block_items`、`item_comments` 开启 Realtime 实时订阅（刻意不包含 `poll_votes`，以保护匿名投票隐私）。
2. `supabase/migrations/002_rls_policies.sql`
   - 创建 5 个 `SECURITY DEFINER` 权限辅助函数（固定 `SET search_path = public` 并回收 `PUBLIC` 执行权限），为全部 8 张表开启 RLS，通过 `is_room_active` 强制执行归档只读锁，通过 `BEFORE UPDATE` 触发器保护不可变字段与审计链路，并创建私有存储桶 `room-media` 及按房间隔离的 `storage.objects` 访问策略。
3. `supabase/migrations/003_rpcs.sql`
   - 创建 `generate_unique_room_code()` 以及 14 个第一阶段原子 `SECURITY DEFINER` RPC 函数，覆盖模板建房、6 位房间码直进/审批入房、匿名安全的投票与统计、任务认领/状态流转/实拍图更新、软删除/一键恢复以及房主手动归档。
4. `supabase/migrations/004_stage2_chat_and_compliance.sql`
   - 新增第二阶段 4 张数据表（`room_messages`、`message_reports`、`user_blocks`、`room_chat_reads`）；扩展 `activity_logs` 支持 `delete_message` 与 `leave_room` 操作记录；在保留 `room_code`/`status`/`archived_at` 不可变保护的前提下放开活跃房间管理员对 `rooms.chat_enabled` 的切换；配置四张新表 RLS（消息查询在数据库层自动过滤软删除消息与被拉黑发送者，写操作强制经由 RPC）；将 `room_messages` 加入 `supabase_realtime`（继续严格排除 `poll_votes`）。
5. `supabase/migrations/005_stage2_rpcs_and_auto_archive.sql`
   - 先删除第一阶段 6 参数版 `create_room_with_template` 重载再升级为支持 `p_chat_enabled` 的 7 参数版本（未传时 `campus`/`travel` 默认开启，`party`/`custom` 默认关闭）；新增 `send_room_message`、`soft_delete_room_message`、`report_room_message`、`reorder_room_blocks`、`leave_room` 与仅限 `service_role` 调用的 `auto_archive_expired_rooms()`；若已启用 `pg_cron`，自动幂等注册每日任务 `poproom-auto-archive-daily`。
6. `supabase/migrations/006_announcement_acks.sql`
   - 为 `rooms` 增加 `announcement_updated_at` 公告版本时间戳与自动更新触发器；新增 `room_announcement_acks` 公告确认表、RLS、Realtime 订阅与 `acknowledge_room_announcement(p_room_id)` 原子 RPC（房主修改公告后旧确认自动失效，需全员重新确认）。

> 提示：建议在 **SQL Editor** 中每次新建一个查询标签页，完整粘贴单个脚本内容并点击 **Run** 执行成功后再运行下一个脚本。

## 4. 关闭“Confirm Email”（Expo Go 联调认证配置）

由于 Supabase 免费版自带 SMTP 有严格发送限频（约每小时 2 封邮件），当前采用“邮箱 + 密码”免邮件验证直接注册登录：

1. 在 Supabase 控制台中进入 **Authentication** → **Providers** → **Email**。
2. 将 **Confirm Email** 开关切换为 **OFF**（关闭）。
3. 点击 **Save** 保存。

## 5. 配置本地 `.env` 环境变量

1. 在 Supabase 控制台中打开 **Project Settings** → **API**（或 **Data API** / **API Keys**）。
2. 将项目根目录下的 `.env.example` 复制为 `.env`，填入你的项目凭证：

```env
EXPO_PUBLIC_SUPABASE_URL=https://your-project-ref.supabase.co
EXPO_PUBLIC_SUPABASE_ANON_KEY=your-anon-key
```

3. 每次修改 `.env` 后，请重启 Expo 并清理缓存（`npx.cmd expo start -c`）。
