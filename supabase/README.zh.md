# 轻橘 PopRoom Supabase 配置指南（第一阶段 MVP）

[English](./README.md) | 简体中文

按以下步骤在一个全新的 Supabase 项目中初始化 PostgreSQL 表结构、行级安全策略（RLS）、私有存储桶 `room-media`、Realtime 实时发布以及原子 RPC 函数。

## 1. 创建 Supabase 项目

1. 登录 [Supabase 控制台](https://supabase.com/dashboard)，点击 **New Project**。
2. 选择所属组织、填写项目名称（例如 `poproom-mvp`）、设置强数据库密码，并选择离你最近的区域（Region）。
3. 等待数据库初始化完成。

## 2. 按顺序执行数据库迁移脚本（`001` → `002` → `003`）

在 Supabase 项目控制台中打开 **SQL Editor**，严格按以下先后顺序执行迁移脚本：

1. `supabase/migrations/001_initial_schema.sql`
   - 创建 8 张核心数据表（`profiles`、`rooms`、`room_members`、`blocks`、`block_items`、`poll_votes`、`item_comments`、`activity_logs`）、索引与触发器，并为 `rooms`、`room_members`、`blocks`、`block_items`、`item_comments` 开启 Realtime 实时订阅（刻意不包含 `poll_votes`，以保护匿名投票隐私）。
2. `supabase/migrations/002_rls_policies.sql`
   - 创建 5 个 `SECURITY DEFINER` 权限辅助函数（固定 `SET search_path = public` 并回收 `PUBLIC` 执行权限），为全部 8 张表开启 RLS，通过 `is_room_active` 强制执行归档只读锁，通过 `BEFORE UPDATE` 触发器保护不可变字段与审计链路，并创建私有存储桶 `room-media` 及按房间隔离的 `storage.objects` 访问策略。
3. `supabase/migrations/003_rpcs.sql`
   - 创建 `generate_unique_room_code()` 以及 14 个原子 `SECURITY DEFINER` RPC 函数，覆盖模板建房、6 位房间码直进/审批入房、匿名安全的投票与统计、任务认领/状态流转/实拍图更新、软删除/一键恢复以及房主手动归档。

> 提示：建议在 **SQL Editor** 中每次新建一个查询标签页，完整粘贴单个脚本内容并点击 **Run** 执行成功后再运行下一个脚本。

## 3. 关闭“Confirm Email”（第一阶段 MVP 认证配置）

由于 Supabase 免费版自带 SMTP 有严格发送限频（约每小时 2 封邮件），第一阶段 MVP 采用“邮箱 + 密码”免邮件验证直接注册登录：

1. 在 Supabase 控制台中进入 **Authentication** → **Providers** → **Email**。
2. 将 **Confirm Email** 开关切换为 **OFF**（关闭）。
3. 点击 **Save** 保存。

## 4. 配置本地 `.env` 环境变量

1. 在 Supabase 控制台中打开 **Project Settings** → **API**（或 **Data API** / **API Keys**）。
2. 将项目根目录下的 `.env.example` 复制为 `.env`，填入你的项目凭证：

```env
EXPO_PUBLIC_SUPABASE_URL=https://your-project-ref.supabase.co
EXPO_PUBLIC_SUPABASE_ANON_KEY=your-anon-key
```

3. 每次修改 `.env` 后，请重启 Expo 并清理缓存（`npx.cmd expo start -c`）。
