# 轻橘 PopRoom — 安卓独立安装包内测版（Android Beta APK）发布与验收指南

> **目标产物**：可直接分发安装的 Android 内测 `.apk`（EAS `preview` profile，`com.poproom.app`）
> **前置基线**：Stage 1 + Stage 2 + 公告确认 + 看板总览 UI 改版（数据库迁移 `001`–`006`）

---

## 1. 一次性 EAS 云端初始化（首次出包必做）

> ⚠️ **关键提醒**：项目根目录的 `.env` 已被 `.gitignore` 忽略，**不会**随代码上传至 EAS 构建服务器。如果不配置 EAS 云端环境变量，打出的 APK 会退回占位地址 `placeholder.supabase.co`，导致所有测试用户无法登录！

在项目根目录 `d:\PopRoom` 的 PowerShell 中依次执行：

1. **登录 Expo / EAS 账号**（如无账号，先前往 [expo.dev](https://expo.dev) 注册免费账号）：
   ```powershell
   npx.cmd eas-cli login
   ```
2. **绑定 EAS 项目 ID**（会在 `app.json` 写入 `expo.extra.eas.projectId`，完成后建议提交该修改）：
   ```powershell
   npx.cmd eas-cli init
   ```
3. **为 `preview` 环境写入 Supabase 环境变量**（值与本地 `.env` 一致）：
   ```powershell
   npx.cmd eas-cli env:create --environment preview --name EXPO_PUBLIC_SUPABASE_URL --value "https://<你的项目>.supabase.co" --visibility plaintext
   npx.cmd eas-cli env:create --environment preview --name EXPO_PUBLIC_SUPABASE_ANON_KEY --value "<你的-anon-key>" --visibility plaintext
   ```
   > 提示：`EXPO_PUBLIC_*` 客户端环境变量会内联至 JS Bundle，使用 `--visibility plaintext` 或 `sensitive` 均可（Anon Key 为 Supabase 公开客户端密钥，数据安全由 RLS 与 `SECURITY DEFINER` RPC 保障）。

---

## 2. Supabase 线上环境核验（出包前）

在 Supabase Dashboard 中确认目标内测实例已完成：

- [ ] SQL 迁移脚本已按顺序执行完毕：`001` → `002` → `003` → `004` → `005` → `006`（详见 [supabase/README.zh.md](../../../supabase/README.zh.md)）。
- [ ] Storage 私有存储桶 `room-media` 及其按房间隔离的 RLS 策略已生效。
- [ ] `Database → Extensions` 中 `pg_cron` 已开启，且 `poproom-auto-archive-daily` 定时任务存在。
- [ ] `Authentication → Providers → Email` 中 **Confirm Email** 为 **OFF**（内测阶段免邮箱验证直接注册，避免免费版 SMTP 每小时 2 封限频阻塞测试同学）。

---

## 3. 出包前门禁检查 & 一键打包 APK

1. **运行类型检查、全量单测与严格发布预检**：
   ```powershell
   npm.cmd run typecheck
   npm.cmd test
   npm.cmd run release:check -- --strict
   ```
   > 确认三项命令均返回退出码 `0`（0 错误）。

2. **触发 EAS 云端构建 Android 内测 APK**：
   ```powershell
   npm.cmd run build:android:beta
   ```
   - 首次构建时 EAS 会询问是否自动生成新的 Android Keystore，选择 **Yes**（由 EAS 托管签名密钥即可）。
   - 等待约 5–12 分钟，终端会输出构建详情页链接与 `.apk` 下载地址 / 二维码。

3. **后续迭代升级包**：
   - 每次发布新内测包前，在 `app.json` 中将 `expo.android.versionCode` 递增（如 `1` → `2`），必要时更新 `expo.version`（如 `0.1.0` → `0.1.1`），确保安卓手机可直接覆盖安装而无需卸载重装。

---

## 4. 分发给安卓内测用户

- **方式 A（推荐）**：直接将 EAS 构建详情页的下载链接或二维码发到内测群，手机浏览器扫码下载安装。
- **方式 B**：从 EAS 下载 `.apk` 文件后通过微信 / 飞书 / QQ 传文件发给测试同学（微信可能自动追加 `.1` 后缀，直接发群文件或在系统文件管理中点击安装）。
- **首次安装提示**：安卓系统会提示「未知来源应用」或「纯净模式/安全守护」，指引测试同学在安装弹窗中允许当前浏览器/文件管理器安装，或暂时点击「继续安装」。
- **反馈 Bug 规范**：请测试同学进入底部 **「我的」→「内测版本信息」**，点击 **「复制诊断信息」** 粘贴到反馈群（包含版本号、Build 号、云端连接状态与脱敏用户前缀，绝不含密钥）。

---

## 5. 安卓独立 APK 专属真机冒烟清单（对比 Expo Go 差异项）

> 核心协作功能验收继续沿用 [stage2-device-checklist.md](./stage2-device-checklist.md)；以下为独立 APK 必须单独确认的原生行为：

- [ ] **桌面图标与启动屏**：安装后桌面图标为 Palette A 暖橘四格标（圆形/圆角矩形桌面遮罩下图标居中不被裁切）；冷启动展示 `#F6F5F2` 暖瓷底 + 暖橘居中徽标，无生硬白闪。
- [ ] **云端环境与诊断卡片**：注册/登录后打开 **「我的」→「内测版本信息」**，确认徽章显示绿色 **「云端已连接」**、`轻橘 PopRoom v0.1.0 · Build 1 (android)` 及真实 Supabase 域名；点击 **「复制诊断信息」** 提示成功且粘贴内容无密钥泄露。
- [ ] **外部 Deep Link 直达进房**：在手机浏览器或备忘录点击 `poproom://room/join?code=<6位有效码>`，确认能直接拉起独立 App 并跳转到进房页自动填入房间码。
- [ ] **剪贴板自动识别**：在微信复制邀请文案后切回轻橘 PopRoom，确认顶部弹出房间码识别提示并跳转进房（自己已在房间内时不误触发）。
- [ ] **相册/相机权限与最小化**：在任务积木上传实拍图 / 经费积木上传收据凭证时，分别测试「从相册选择」与「拍照」——确认仅申请相机/照片权限，**不弹出麦克风录音权限请求**，上传后双机均能正常加载签名预览图。
- [ ] **Android 11+ 地图 App 唤起**：在已安装高德地图或百度地图的安卓机上，点击日程轴某条目的地点导航，确认可直接拉起对应地图 App（验证 `withAndroidMapQueries` `<queries>` 生效，不再被迫回退浏览器）。
- [ ] **聊天室键盘适配**：进入已开启聊天室的房间点击底部输入框，确认系统软键盘弹出时输入栏顺滑上移且不遮挡最新消息（验证 `softwareKeyboardLayoutMode: "resize"`）。
- [ ] **复盘导出与原生分享**：在房间「复盘导出」分别点击导出高清 PNG 长图与 A4 PDF，确认能正常拉起安卓系统分享面板并保存/发送文件。
- [ ] **冷启动离线缓存与未读持久化**：强杀 App 进程后重新打开，确认大厅与已进房间立即可见缓存内容，聊天室已读红点保持清零不回跳。
