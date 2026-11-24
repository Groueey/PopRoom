# 轻橘 PopRoom 安卓独立安装包内测版（Android Beta APK）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Package **轻橘 PopRoom** (Stage 1 + Stage 2 + Board Overview UI) into a crash-resilient, directly installable Android standalone beta APK (`eas build --platform android --profile preview`) with brand assets, Android manifest config plugins, runtime error recovery, beta diagnostics, and an automated preflight gate.

**Architecture:** Lock the existing uncommitted Board Overview / Palette A UI work as a clean git baseline first, then layer Android-only standalone release engineering without breaking Expo Go compatibility: deterministic zero-dependency PNG brand asset generation (`assets/`), an idempotent local Expo config plugin (`plugins/withAndroidMapQueries.js`) plus `app.json` / `eas.json` APK build profiles, runtime resilience (`AppErrorBoundary` + `appVersion.ts` diagnostics in `profile.tsx`), and an automated preflight check (`scripts/verify-release-readiness.mjs`) paired with a step-by-step Android beta distribution & smoke-test runbook.

**Tech Stack:** Expo SDK 58 (`~58.0.26`), Expo Router, `expo/config-plugins`, `expo-image-picker` config plugin, `expo-constants`, `expo-clipboard`, EAS Build (`preview` APK profile), React Native 0.88, TypeScript (Strict Mode), NativeWind v4, Node.js (`node:zlib` for deterministic PNG generation), Vitest.

**Spec:** Built on Stage 1/2 baselines ([app.md](../../../app.md), [2026-11-22-poproom-stage2-design.md](../specs/2026-11-22-poproom-stage2-design.md)) scoped to Tier 2 **Android-first standalone internal beta** (deferring iOS TestFlight, `expo-notifications` remote push, and Stage 3 third-party auth / account deletion).

## Global Constraints

- **Android-First Scope (Tier 2):** Target standalone Android internal beta APK (`buildType: "apk"`, `distribution: "internal"`); do NOT add `expo-notifications`, Apple/WeChat native login, or Stage 3 DB migrations (`001`–`006` stay unchanged).
- **Expo Go Compatibility Preserved:** Every change MUST keep `npx.cmd expo start` working in Expo Go alongside EAS standalone Android builds (do not install native-only runtime libraries that crash in Expo Go).
- **Strict Type Safety:** Zero `any` in `src/` or `app/`; `npm.cmd run typecheck` (`tsc --noEmit`) MUST exit 0 after every code task.
- **Brand Visual Consistency (Palette A):** Brand icons, adaptive icon, splash screen, error boundary, and beta diagnostics UI MUST follow `src/lib/theme.ts` (`primary: #E05A2B`, `primaryDeep: #C4481D`, `surface: #F6F5F2`, `ink: #1F1D1A`).
- **Zero Secret Leakage:** Diagnostics UI, error boundary copy, and preflight scripts MUST NEVER print or copy `EXPO_PUBLIC_SUPABASE_ANON_KEY`, auth tokens, or full `.env` contents.
- **Windows Shell Execution:** Run Node/NPM/Expo commands via `npm.cmd`, `npx.cmd`, and `node` in PowerShell.

## Review Focus

1. **EAS cloud build shipping with placeholder Supabase credentials:** `.env` is gitignored and never uploaded to EAS servers; without `preview` EAS env vars the APK silently falls back to `placeholder.supabase.co`. *Pinned in Task 4 (`tests/lib/appVersion.test.ts`) & Task 5 (`tests/release/releaseReadiness.test.ts`).*
2. **Android 11+ (API 30+) package visibility blocking Amap / Baidu Map deep links:** `Linking.canOpenURL('androidamap://...')` and `baidumap://` in `ScheduleBlock.tsx` return `false` in standalone APKs unless declared in `<queries><intent>` inside `AndroidManifest.xml`. *Pinned in Task 3 (`tests/release/androidBuildConfig.test.ts`).*
3. **Invalid PNG assets or unpadded Android adaptive icon clipping:** Corrupt/missing assets fail Gradle builds, and non-transparent edge pixels on `adaptive-icon.png` get awkwardly cropped by OEM circular/squircle launcher masks. *Pinned in Task 2 (`tests/release/brandAssets.test.ts`) & Task 5 (`tests/release/releaseReadiness.test.ts`).*
4. **Unhandled render exception hard-crashing the release APK with no trace:** Release APKs have no Expo Go redbox; testers need a calm recovery screen plus one-tap diagnostics that never expose API keys. *Pinned in Task 4 (`tests/lib/appVersion.test.ts`).*
5. **Unwanted `RECORD_AUDIO` permission or broken `poproom://` deep-link intent on Android:** Unconfigured `expo-image-picker` requests microphone permission on Android, and missing Android `intentFilters` breaks external `poproom://room/join?code=XXXXXX` links. *Pinned in Task 3 (`tests/release/androidBuildConfig.test.ts`) & Task 5 (`tests/release/releaseReadiness.test.ts`).*

---

## File Structure Map

```text
PopRoom/
├── assets/
│   ├── icon.png                                            # 1024x1024 opaque terracotta brand icon
│   ├── adaptive-icon.png                                   # 1024x1024 transparent-edge Android adaptive foreground
│   ├── splash-icon.png                                     # 1024x1024 centered mark for #F6F5F2 warm porcelain splash
│   └── favicon.png                                         # 48x48 web favicon
├── plugins/
│   ├── withAndroidMapQueries.js                            # Expo config plugin adding androidamap/baidumap <queries>
│   └── withAndroidMapQueries.d.ts                          # Strict TS declarations for plugin test imports
├── scripts/
│   ├── generate-brand-assets.mjs                           # Deterministic zero-dep Node PNG generator for assets/
│   ├── verify-release-readiness.mjs                        # Automated Android beta preflight gate + CLI runner
│   └── verify-release-readiness.d.mts                      # Strict TS declarations for preflight unit tests
├── app.json                                                # Android icon/splash/versionCode/intentFilters/plugins
├── eas.json                                                # EAS Build profiles (development, preview APK, production)
├── package.json                                            # + release:check & build:android:beta scripts
├── src/
│   ├── lib/
│   │   └── appVersion.ts                                   # Pure beta build info, safe Supabase host & diagnostics formatter
│   └── components/ui/
│       └── AppErrorBoundary.tsx                            # Global React error boundary for standalone release resilience
├── app/
│   ├── _layout.tsx                                         # Wrap RootNavigator with AppErrorBoundary
│   └── (tabs)/profile.tsx                                  # + Compact "内测版本信息" card with one-tap copy diagnostics
├── docs/superpowers/verification/
│   └── android-beta-release-guide.md                       # EAS setup, APK build, distribution & Android smoke checklist
└── tests/
    ├── lib/
    │   └── appVersion.test.ts                              # Safe host extraction, diagnostics formatting & error summary tests
    └── release/
        ├── brandAssets.test.ts                             # PNG signature, IHDR dimensions & adaptive safe-zone checks
        ├── androidBuildConfig.test.ts                      # app.json, eas.json & withAndroidMapQueries idempotency tests
        └── releaseReadiness.test.ts                        # Preflight evaluator pass/warn/fail contract tests
```

---

## Task 1: Verify & Commit Current Working-Tree Baseline (Board Overview & Palette A)

**Files:**
- Commit existing modified files: `app/room/[id]/index.tsx`, `src/components/blocks/ExpenseBlock.tsx`, `src/components/blocks/PollBlock.tsx`, `src/components/blocks/ScheduleBlock.tsx`, `src/components/blocks/TaskBlock.tsx`, `src/components/chat/BlockReminderCard.tsx`, `src/components/ui/Badge.tsx`, `src/components/ui/Motion.tsx`, `src/lib/theme.ts`, `tailwind.config.js`
- Commit existing untracked files: `src/lib/boardOverviewHelpers.ts`, `tests/lib/boardOverviewHelpers.test.ts`

**Interfaces:**
- Consumes: Current `main` working tree.
- Produces: Clean git working tree on `main` with all 204 existing unit tests green so EAS Build archives only clean, tracked changes.

- [ ] **Step 1: Verify typecheck and full existing test suite pass on the current working tree**

Run: `npm.cmd run typecheck; npm.cmd test`
Expected: `tsc --noEmit` exits 0; Vitest passes all 24 test files (204 tests).

- [ ] **Step 2: Inspect `git status` to ensure no temporary or secret files (`.env`, logs) are staged**

Run: `git status -s`
Expected: Only the 10 modified UI/theme files and 2 `boardOverviewHelpers` files appear; `.env` is ignored.

- [ ] **Step 3: Stage and commit the baseline UI refresh**

```powershell
git add app/room/[id]/index.tsx src/components/blocks/ExpenseBlock.tsx src/components/blocks/PollBlock.tsx src/components/blocks/ScheduleBlock.tsx src/components/blocks/TaskBlock.tsx src/components/chat/BlockReminderCard.tsx src/components/ui/Badge.tsx src/components/ui/Motion.tsx src/lib/theme.ts tailwind.config.js src/lib/boardOverviewHelpers.ts tests/lib/boardOverviewHelpers.test.ts
git commit -m "feat(ui): polish board overview summary stream and Palette A warm porcelain styling"
```

Expected: `git status -s` outputs nothing (clean tree).

---

## Task 2: Brand PNG Assets (`assets/`) & Deterministic Generator

**Files:**
- Create: `scripts/generate-brand-assets.mjs`
- Create: `assets/icon.png`
- Create: `assets/adaptive-icon.png`
- Create: `assets/splash-icon.png`
- Create: `assets/favicon.png`
- Test: `tests/release/brandAssets.test.ts`

**Interfaces:**
- Consumes: Palette A colors from `src/lib/theme.ts` (`#E05A2B`, `#C4481D`, `#FDF1EC`, `#F6F5F2`).
- Produces:
  - `assets/icon.png` (1024×1024 RGBA PNG, opaque terracotta canvas with centered PopRoom tangerine-room emblem)
  - `assets/adaptive-icon.png` (1024×1024 RGBA PNG, transparent outer margin outside center 66% safe zone so Android OEM masks never clip the mark)
  - `assets/splash-icon.png` (1024×1024 RGBA PNG, centered emblem on transparent background for `#F6F5F2` splash)
  - `assets/favicon.png` (48×48 RGBA PNG)
  - `scripts/generate-brand-assets.mjs` (re-runnable via `node scripts/generate-brand-assets.mjs`)

- [ ] **Step 1: Write the failing asset contract test `tests/release/brandAssets.test.ts`**

Create `tests/release/brandAssets.test.ts` that reads each file under `assets/`, parses the PNG magic header (`89 50 4E 47 0D 0A 1A 0A`) and `IHDR` chunk (width, height, bitDepth, colorType), and inflates `IDAT` via `node:zlib` to sample corner pixels *(Review Focus #3)*:

```ts
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { describe, expect, it } from 'vitest';

const ASSETS_DIR = path.resolve(process.cwd(), 'assets');
const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

interface PngInfo {
  width: number;
  height: number;
  colorType: number;
  topLeftAlpha: number;
  centerAlpha: number;
}

function inspectPng(filePath: string): PngInfo {
  const buf = fs.readFileSync(filePath);
  expect(buf.subarray(0, 8).equals(PNG_SIGNATURE)).toBe(true);
  const width = buf.readUInt32BE(16);
  const height = buf.readUInt32BE(20);
  const colorType = buf.readUInt8(25);
  // Collect IDAT chunks, inflate, inspect top-left (0,0) and center pixel alpha when RGBA (colorType === 6)
  const idats: Buffer[] = [];
  let offset = 8;
  while (offset < buf.length) {
    const length = buf.readUInt32BE(offset);
    const type = buf.toString('ascii', offset + 4, offset + 8);
    if (type === 'IDAT') {
      idats.push(buf.subarray(offset + 8, offset + 8 + length));
    }
    offset += 12 + length;
  }
  const raw = zlib.inflateSync(Buffer.concat(idats));
  const bpp = colorType === 6 ? 4 : 3;
  const stride = 1 + width * bpp;
  const topLeftAlpha = colorType === 6 ? (raw[4] ?? -1) : 255;
  const cy = Math.floor(height / 2);
  const cx = Math.floor(width / 2);
  const centerAlpha = colorType === 6 ? (raw[cy * stride + 1 + cx * 4 + 3] ?? -1) : 255;
  return { width, height, colorType, topLeftAlpha, centerAlpha };
}

describe('PopRoom brand PNG assets', () => {
  it('provides valid 1024x1024 opaque icon.png', () => {
    const info = inspectPng(path.join(ASSETS_DIR, 'icon.png'));
    expect(info.width).toBe(1024);
    expect(info.height).toBe(1024);
    expect(info.topLeftAlpha).toBe(255);
    expect(info.centerAlpha).toBe(255);
  });

  it('provides valid 1024x1024 adaptive-icon.png with transparent outer safe-zone margin', () => {
    const info = inspectPng(path.join(ASSETS_DIR, 'adaptive-icon.png'));
    expect(info.width).toBe(1024);
    expect(info.height).toBe(1024);
    expect(info.colorType).toBe(6);
    expect(info.topLeftAlpha).toBe(0);
    expect(info.centerAlpha).toBe(255);
  });

  it('provides valid 1024x1024 splash-icon.png with transparent background', () => {
    const info = inspectPng(path.join(ASSETS_DIR, 'splash-icon.png'));
    expect(info.width).toBe(1024);
    expect(info.height).toBe(1024);
    expect(info.colorType).toBe(6);
    expect(info.topLeftAlpha).toBe(0);
    expect(info.centerAlpha).toBe(255);
  });

  it('provides valid 48x48 favicon.png', () => {
    const info = inspectPng(path.join(ASSETS_DIR, 'favicon.png'));
    expect(info.width).toBe(48);
    expect(info.height).toBe(48);
    expect(info.centerAlpha).toBe(255);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx.cmd vitest run tests/release/brandAssets.test.ts`
Expected: FAIL with `ENOENT: no such file or directory` for `assets/icon.png`.

- [ ] **Step 3: Implement `scripts/generate-brand-assets.mjs` and run it to generate all 4 PNGs**

Create `scripts/generate-brand-assets.mjs` using only `node:fs`, `node:path`, and `node:zlib`:
- Implement a clean RGBA PNG encoder (`encodeRgbaPng(width, height, rgbaBuffer)`) writing PNG signature, `IHDR` (8-bit RGBA `colorType = 6`), filter-byte-0 scanlines compressed with `zlib.deflateSync`, CRC32 checksums, and `IEND`.
- Render the **轻橘 PopRoom** geometric mark (signed-distance anti-aliased shapes so edges are smooth at 1024×1024):
  - Warm terracotta rounded emblem (`#E05A2B` gradient toward `#C4481D`) containing a clean warm-white (`#FDF1EC` / `#FFFFFF`) minimalist room-block / tangerine quadrant motif (4 rounded collaborative tile quarters representing the 4 PopRoom blocks, with a small sage-green `#2A8565` leaf accent at top-right).
  - For `icon.png` (1024×1024): full-bleed opaque `#E05A2B` → `#C4481D` subtle vertical gradient background with emblem centered at ~72% scale.
  - For `adaptive-icon.png` (1024×1024): fully transparent background (`alpha = 0` outside safe zone) with the emblem scaled strictly inside the central 58% diameter (well inside Android's 66% adaptive icon safe circle).
  - For `splash-icon.png` (1024×1024): fully transparent background with a crisp terracotta rounded-square emblem centered at ~60% scale (renders cleanly against `#F6F5F2` warm porcelain splash background).
  - For `favicon.png` (48×48): downsampled/rendered 48×48 version of the brand mark.
- Run: `node scripts/generate-brand-assets.mjs`

- [ ] **Step 4: Run test to verify all 4 assets pass**

Run: `npx.cmd vitest run tests/release/brandAssets.test.ts`
Expected: PASS (4/4 tests green).

- [ ] **Step 5: Commit**

```powershell
git add scripts/generate-brand-assets.mjs assets/icon.png assets/adaptive-icon.png assets/splash-icon.png assets/favicon.png tests/release/brandAssets.test.ts
git commit -m "feat(assets): add Palette A brand icon, adaptive icon, splash, and favicon PNGs"
```

---

## Task 3: Android Standalone Config (`app.json`, `eas.json`) & Map Queries Config Plugin

**Files:**
- Create: `plugins/withAndroidMapQueries.js`
- Create: `plugins/withAndroidMapQueries.d.ts`
- Create: `eas.json`
- Modify: `app.json:1-28`
- Modify: `package.json:6-14`
- Test: `tests/release/androidBuildConfig.test.ts`

**Interfaces:**
- Consumes: `assets/*.png` from Task 2; `expo/config-plugins` (`withAndroidManifest`); `src/lib/mapNavigation.ts` schemes (`androidamap`, `baidumap`).
- Produces:
  - `plugins/withAndroidMapQueries.js`: default export Expo config plugin `withAndroidMapQueries(config)` AND named export `addMapQueriesToManifest(androidManifest)` (pure function mutating/returning `androidManifest` idempotently so unit tests do not require prebuild).
  - `app.json`: Android standalone metadata (`icon`, `splash`, `android.versionCode`, `android.adaptiveIcon`, `android.softwareKeyboardLayoutMode: "resize"`, `android.intentFilters` for `poproom://`, `expo-image-picker` plugin with Chinese copy & `microphonePermission: false`, and `./plugins/withAndroidMapQueries`).
  - `eas.json`: `development`, `preview` (Android internal APK), and `production` profiles.
  - `package.json` scripts: `"release:check"` and `"build:android:beta"`.

- [ ] **Step 1: Write the failing Android config & plugin contract test `tests/release/androidBuildConfig.test.ts`**

Create `tests/release/androidBuildConfig.test.ts` asserting *(Review Focus #2 & #5)*:

```ts
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = process.cwd();

function readJson<T>(relativePath: string): T {
  return JSON.parse(fs.readFileSync(path.join(ROOT, relativePath), 'utf8')) as T;
}

describe('Android standalone build configuration', () => {
  it('configures app.json with brand assets, Android versionCode, deep link intentFilter, and plugins', () => {
    const appJson = readJson<{ expo: Record<string, unknown> }>('app.json');
    const expo = appJson.expo;
    expect(expo.icon).toBe('./assets/icon.png');
    expect(expo.scheme).toBe('poproom');
    expect(expo.splash).toEqual({
      image: './assets/splash-icon.png',
      resizeMode: 'contain',
      backgroundColor: '#F6F5F2',
    });

    const android = expo.android as Record<string, unknown>;
    expect(android.package).toBe('com.poproom.app');
    expect(android.versionCode).toBeGreaterThanOrEqual(1);
    expect(android.softwareKeyboardLayoutMode).toBe('resize');
    expect(android.adaptiveIcon).toEqual({
      foregroundImage: './assets/adaptive-icon.png',
      backgroundColor: '#E05A2B',
    });

    const intentFilters = android.intentFilters as Array<Record<string, unknown>>;
    expect(Array.isArray(intentFilters)).toBe(true);
    expect(
      intentFilters.some((filter) => {
        const data = filter.data as Array<{ scheme?: string }> | undefined;
        return filter.action === 'VIEW' && data?.some((d) => d.scheme === 'poproom');
      }),
    ).toBe(true);

    const plugins = expo.plugins as unknown[];
    expect(plugins).toContain('expo-router');
    expect(plugins).toContain('./plugins/withAndroidMapQueries');

    const imagePickerEntry = plugins.find(
      (entry): entry is [string, Record<string, unknown>] =>
        Array.isArray(entry) && entry[0] === 'expo-image-picker',
    );
    expect(imagePickerEntry).toBeDefined();
    expect(imagePickerEntry?.[1].microphonePermission).toBe(false);
    expect(String(imagePickerEntry?.[1].photosPermission)).toContain('相册');
    expect(String(imagePickerEntry?.[1].cameraPermission)).toContain('相机');
  });

  it('configures eas.json with Android internal APK preview profile', () => {
    const eas = readJson<{
      cli: { version: string; appVersionSource: string };
      build: {
        development: { developmentClient: boolean; android: { buildType: string } };
        preview: { distribution: string; android: { buildType: string } };
        production: { android: { buildType: string } };
      };
    }>('eas.json');

    expect(eas.cli.appVersionSource).toBe('local');
    expect(eas.build.preview.distribution).toBe('internal');
    expect(eas.build.preview.android.buildType).toBe('apk');
    expect(eas.build.development.developmentClient).toBe(true);
    expect(eas.build.production.android.buildType).toBe('app-bundle');
  });

  it('withAndroidMapQueries adds androidamap and baidumap <queries> idempotently', async () => {
    const mod = await import('../../plugins/withAndroidMapQueries.js');
    const addMapQueriesToManifest = mod.addMapQueriesToManifest as (
      manifest: Record<string, unknown>,
    ) => Record<string, unknown>;

    const manifest: Record<string, unknown> = { manifest: {} };
    addMapQueriesToManifest(manifest);
    addMapQueriesToManifest(manifest); // idempotency check

    const root = manifest.manifest as {
      queries?: Array<{
        intent?: Array<{
          action?: Array<{ $: { 'android:name': string } }>;
          data?: Array<{ $: { 'android:scheme': string } }>;
        }>;
      }>;
    };

    const intents = root.queries?.[0]?.intent ?? [];
    const schemes = intents
      .map((item) => item.data?.[0]?.$?.['android:scheme'])
      .filter(Boolean);

    expect(schemes).toEqual(['androidamap', 'baidumap']);
    expect(
      intents.every(
        (item) => item.action?.[0]?.$?.['android:name'] === 'android.intent.action.VIEW',
      ),
    ).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx.cmd vitest run tests/release/androidBuildConfig.test.ts`
Expected: FAIL on missing `app.json` fields, missing `eas.json`, and missing `plugins/withAndroidMapQueries.js`.

- [ ] **Step 3: Implement `plugins/withAndroidMapQueries.js` and `plugins/withAndroidMapQueries.d.ts`**

Create CommonJS module `plugins/withAndroidMapQueries.js`:
- Define `MAP_SCHEMES = ['androidamap', 'baidumap']`.
- Export `addMapQueriesToManifest(androidManifest)` that ensures `androidManifest.manifest.queries` has an entry with an `intent` array, and for each scheme in `MAP_SCHEMES` appends `{ action: [{ $: { 'android:name': 'android.intent.action.VIEW' } }], data: [{ $: { 'android:scheme': scheme } }] }` only if an intent with that `android:scheme` does not already exist.
- Export default `withAndroidMapQueries(config)` using `const { withAndroidManifest } = require('expo/config-plugins')` calling `addMapQueriesToManifest(mod.modResults)`.
- Attach `withAndroidMapQueries.addMapQueriesToManifest = addMapQueriesToManifest` (so both `require` and Vitest ESM `import` work seamlessly).
- Add matching `plugins/withAndroidMapQueries.d.ts` declaring `addMapQueriesToManifest(manifest: Record<string, unknown>): Record<string, unknown>` and default export so `tsc --noEmit` typechecks `tests/release/androidBuildConfig.test.ts` cleanly under strict mode.

- [ ] **Step 4: Update `app.json`, create `eas.json`, and add release scripts to `package.json`**

1. Update `app.json`:
   - Add top-level `"icon": "./assets/icon.png"` and `"splash": { "image": "./assets/splash-icon.png", "resizeMode": "contain", "backgroundColor": "#F6F5F2" }`.
   - Under `android`: keep `"package": "com.poproom.app"`, add `"versionCode": 1`, `"adaptiveIcon": { "foregroundImage": "./assets/adaptive-icon.png", "backgroundColor": "#E05A2B" }`, `"softwareKeyboardLayoutMode": "resize"`, and `"intentFilters": [{ "action": "VIEW", "data": [{ "scheme": "poproom" }], "category": ["BROWSABLE", "DEFAULT"] }]`.
   - Under `web`: add `"favicon": "./assets/favicon.png"`.
   - Under `plugins`:
     - `"expo-router"`
     - `["expo-image-picker", { "photosPermission": "轻橘 PopRoom 需要访问你的相册，用于上传任务实拍图和费用凭证。", "cameraPermission": "轻橘 PopRoom 需要使用你的相机，用于现场拍摄任务进度或收据凭证。", "microphonePermission": false, "colors": { "cropToolbarColor": "#E05A2B", "cropToolbarIconColor": "#FFFFFF", "cropToolbarActionTextColor": "#FFFFFF", "cropBackButtonIconColor": "#FFFFFF", "cropBackgroundColor": "#F6F5F2" } }]`
     - `"./plugins/withAndroidMapQueries"`
2. Create `eas.json`:
   ```json
   {
     "cli": {
       "version": ">= 13.0.0",
       "appVersionSource": "local"
     },
     "build": {
       "development": {
         "developmentClient": true,
         "distribution": "internal",
         "android": {
           "buildType": "apk"
         }
       },
       "preview": {
         "distribution": "internal",
         "channel": "preview",
         "environment": "preview",
         "android": {
           "buildType": "apk"
         }
       },
       "production": {
         "channel": "production",
         "environment": "production",
         "android": {
           "buildType": "app-bundle"
         }
       }
     }
   }
   ```
3. Add to `package.json` `"scripts"`:
   - `"release:check": "node scripts/verify-release-readiness.mjs"`
   - `"build:android:beta": "npx eas-cli build --platform android --profile preview"`

- [ ] **Step 5: Run unit tests AND verify Expo config resolution**

Run: `npx.cmd vitest run tests/release/androidBuildConfig.test.ts`
Expected: PASS (3/3 tests green).

Run: `npx.cmd expo config --type public`
Expected: Exits 0 and outputs resolved PopRoom Expo config with `expo-image-picker` and `./plugins/withAndroidMapQueries` loaded without plugin resolution errors.

- [ ] **Step 6: Commit**

```powershell
git add plugins/withAndroidMapQueries.js plugins/withAndroidMapQueries.d.ts app.json eas.json package.json tests/release/androidBuildConfig.test.ts
git commit -m "feat(android): configure EAS preview APK build, permissions, deep link, and map queries plugin"
```

---

## Task 4: Standalone Runtime Safety — Global Error Boundary & Beta Diagnostics Card

**Files:**
- Create: `src/lib/appVersion.ts`
- Create: `src/components/ui/AppErrorBoundary.tsx`
- Modify: `app/_layout.tsx:390-407`
- Modify: `app/(tabs)/profile.tsx:460-480`
- Test: `tests/lib/appVersion.test.ts`

**Interfaces:**
- Consumes: `src/lib/supabase.ts` (`isSupabaseConfigured`), `src/lib/theme.ts` (`THEME_COLORS`, `CARD_SHADOW`), `src/components/ui/Button.tsx`, `src/components/ui/Card.tsx`, `src/components/ui/Badge.tsx`, `expo-constants`, `expo-clipboard`.
- Produces:
  - `src/lib/appVersion.ts`:
    - `export interface AppBuildInfo { appVersion: string; buildNumber: string; platform: string; supabaseConfigured: boolean; supabaseHost: string; }`
    - `export function extractSafeSupabaseHost(rawUrl: string | undefined): string`
    - `export function maskUserIdForDiagnostics(userId: string | null | undefined): string`
    - `export function buildAppBuildInfo(params: { appVersion?: string | null; androidVersionCode?: number | string | null; iosBuildNumber?: string | null; platform: string; rawSupabaseUrl?: string; supabaseConfigured: boolean }): AppBuildInfo`
    - `export function formatBetaDiagnosticsText(info: AppBuildInfo, userId?: string | null): string`
    - `export function formatErrorReportText(error: unknown, info: AppBuildInfo): string`
    - `export function getRuntimeAppBuildInfo(): AppBuildInfo`
  - `src/components/ui/AppErrorBoundary.tsx`: `export class AppErrorBoundary extends React.Component<{ children: React.ReactNode }, { error: Error | null }>`

- [ ] **Step 1: Write the failing unit tests `tests/lib/appVersion.test.ts`**

Create `tests/lib/appVersion.test.ts` covering *(Review Focus #1 & #4)*:

```ts
import { describe, expect, it } from 'vitest';
import {
  buildAppBuildInfo,
  extractSafeSupabaseHost,
  formatBetaDiagnosticsText,
  formatErrorReportText,
  maskUserIdForDiagnostics,
} from '../../src/lib/appVersion';

describe('appVersion & beta diagnostics helpers', () => {
  it('extractSafeSupabaseHost returns only hostname and rejects placeholders/secrets', () => {
    expect(extractSafeSupabaseHost('https://abc123.supabase.co/rest/v1?apikey=secret')).toBe(
      'abc123.supabase.co',
    );
    expect(extractSafeSupabaseHost('https://your-project-ref.supabase.co')).toBe('未配置');
    expect(extractSafeSupabaseHost('https://placeholder.supabase.co')).toBe('未配置');
    expect(extractSafeSupabaseHost('')).toBe('未配置');
    expect(extractSafeSupabaseHost('not-a-url')).toBe('无效地址');
  });

  it('maskUserIdForDiagnostics keeps only first 8 chars or returns 未登录', () => {
    expect(maskUserIdForDiagnostics('12345678-aaaa-bbbb-cccc-1234567890ab')).toBe('12345678…');
    expect(maskUserIdForDiagnostics(null)).toBe('未登录');
    expect(maskUserIdForDiagnostics('')).toBe('未登录');
  });

  it('buildAppBuildInfo resolves Android versionCode cleanly', () => {
    const info = buildAppBuildInfo({
      appVersion: '0.1.0',
      androidVersionCode: 3,
      platform: 'android',
      rawSupabaseUrl: 'https://demo.supabase.co',
      supabaseConfigured: true,
    });
    expect(info).toEqual({
      appVersion: '0.1.0',
      buildNumber: '3',
      platform: 'android',
      supabaseConfigured: true,
      supabaseHost: 'demo.supabase.co',
    });
  });

  it('formatBetaDiagnosticsText clearly flags unconfigured Supabase builds without leaking keys', () => {
    const unconfigured = buildAppBuildInfo({
      appVersion: '0.1.0',
      androidVersionCode: 1,
      platform: 'android',
      rawSupabaseUrl: undefined,
      supabaseConfigured: false,
    });
    const text = formatBetaDiagnosticsText(unconfigured, '12345678-aaaa');
    expect(text).toContain('轻橘 PopRoom v0.1.0 (Build 1)');
    expect(text).toContain('平台：android');
    expect(text).toContain('云端状态：未配置');
    expect(text).toContain('用户：12345678…');
    expect(text).not.toContain('placeholder');
  });

  it('formatErrorReportText truncates long error messages and appends build info', () => {
    const info = buildAppBuildInfo({
      appVersion: '0.1.0',
      androidVersionCode: 1,
      platform: 'android',
      rawSupabaseUrl: 'https://demo.supabase.co',
      supabaseConfigured: true,
    });
    const report = formatErrorReportText(new Error('Boom!'), info);
    expect(report).toContain('轻橘 PopRoom 异常报告');
    expect(report).toContain('Error: Boom!');
    expect(report).toContain('v0.1.0 (Build 1)');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx.cmd vitest run tests/lib/appVersion.test.ts`
Expected: FAIL with module `../../src/lib/appVersion` not found.

- [ ] **Step 3: Implement `src/lib/appVersion.ts`**

Create `src/lib/appVersion.ts`:
- Keep all pure functions (`extractSafeSupabaseHost`, `maskUserIdForDiagnostics`, `buildAppBuildInfo`, `formatBetaDiagnosticsText`, `formatErrorReportText`) free of React Native top-level imports so Vitest runs them cleanly in Node without mocks.
- Implement `getRuntimeAppBuildInfo()` using lazy/runtime access or `expo-constants` (`Constants.expoConfig?.version`, `Constants.expoConfig?.android?.versionCode`, `Constants.expoConfig?.ios?.buildNumber`, `Platform.OS`, `process.env.EXPO_PUBLIC_SUPABASE_URL`, and `isSupabaseConfigured` check). To keep Vitest Node imports clean, put the pure functions in `src/lib/appVersion.ts` and read `expo-constants` inside `getRuntimeAppBuildInfo()` via `require('expo-constants')` / `require('react-native')` guarded with try/catch (mirroring the lazy pattern used in `src/lib/shareInvite.ts`), never reading or exposing `EXPO_PUBLIC_SUPABASE_ANON_KEY`.

- [ ] **Step 4: Implement `src/components/ui/AppErrorBoundary.tsx` and wire into `app/_layout.tsx`**

1. Create `src/components/ui/AppErrorBoundary.tsx`:
   - Class component catching unhandled render errors via `getDerivedStateFromError` and `componentDidCatch`.
   - Renders a Palette A centered recovery card on `bg-surface` (`#F6F5F2`): icon (`AlertTriangle`), title **"页面开小差了"**, concise subtitle **"别担心，已同步到云端的协作记录不会丢失。你可以点击下方按钮重新加载，或复制报错发给开发者。"**, 1-line truncated error message box, primary button **"重新加载"** (clears `error` state), and secondary button **"复制报错信息"** (copies `formatErrorReportText(error, getRuntimeAppBuildInfo())` via `expo-clipboard` and shows inline "已复制" feedback for 2s).
2. Update `app/_layout.tsx`:
   - Wrap `<RootNavigator />` inside `<AppErrorBoundary>` (inside `<SafeAreaProvider>` so safe-area insets work cleanly).

- [ ] **Step 5: Add compact "内测版本信息" card to `app/(tabs)/profile.tsx`**

In `app/(tabs)/profile.tsx`, directly above the **"退出登录"** button:
- Read `const buildInfo = useMemo(() => getRuntimeAppBuildInfo(), []);`.
- Render a compact `<Card>` displaying:
  - Title: **"内测版本信息"** with a `<Badge>` (`云端已连接` in `success` variant when `buildInfo.supabaseConfigured`, or `未配置云端` in `danger` variant otherwise).
  - Subtitle: `轻橘 PopRoom v${buildInfo.appVersion} · Build ${buildInfo.buildNumber} (${buildInfo.platform})` and `节点：${buildInfo.supabaseHost}`.
  - Secondary `sm` `<Button title="复制诊断信息" />` calling `Clipboard.setStringAsync(formatBetaDiagnosticsText(buildInfo, userId))` and `showToast('已复制内测诊断信息，可直接发给开发者', 'success')`.

- [ ] **Step 6: Run tests and typecheck**

Run: `npm.cmd run typecheck; npx.cmd vitest run tests/lib/appVersion.test.ts`
Expected: `tsc --noEmit` exits 0; all 5 tests in `tests/lib/appVersion.test.ts` PASS.

- [ ] **Step 7: Commit**

```powershell
git add src/lib/appVersion.ts src/components/ui/AppErrorBoundary.tsx app/_layout.tsx app/(tabs)/profile.tsx tests/lib/appVersion.test.ts
git commit -m "feat(beta): add global AppErrorBoundary and Profile beta diagnostics card"
```

---

## Task 5: Automated Preflight Gate (`verify-release-readiness.mjs`) & Android Beta Release Runbook

**Files:**
- Create: `scripts/verify-release-readiness.mjs`
- Create: `scripts/verify-release-readiness.d.mts`
- Create: `docs/superpowers/verification/android-beta-release-guide.md`
- Test: `tests/release/releaseReadiness.test.ts`

**Interfaces:**
- Consumes: `app.json`, `eas.json`, `assets/*.png`, `supabase/migrations/001`–`006`, `.env` (existence & placeholder check only — never prints values).
- Produces:
  - `scripts/verify-release-readiness.mjs`:
    - Named export `evaluateReleaseReadiness(snapshot: ReleaseSnapshot): { ok: boolean; errors: string[]; warnings: string[] }` (pure, unit-testable).
    - Executable CLI (`node scripts/verify-release-readiness.mjs [--strict]`) returning exit code `0` when `errors.length === 0` (and in `--strict` mode also requiring `extra.eas.projectId` to be populated).
  - `docs/superpowers/verification/android-beta-release-guide.md`: complete Android APK build, EAS env setup, distribution, and Android standalone smoke checklist.

- [ ] **Step 1: Write the failing preflight evaluator test `tests/release/releaseReadiness.test.ts`**

Create `tests/release/releaseReadiness.test.ts` testing *(Review Focus #1, #3, #5)*:

```ts
import { describe, expect, it } from 'vitest';
import {
  evaluateReleaseReadiness,
  type ReleaseSnapshot,
} from '../../scripts/verify-release-readiness.mjs';

function makeValidSnapshot(): ReleaseSnapshot {
  return {
    strict: false,
    appJson: {
      expo: {
        name: '轻橘 PopRoom',
        slug: 'poproom',
        version: '0.1.0',
        scheme: 'poproom',
        icon: './assets/icon.png',
        splash: {
          image: './assets/splash-icon.png',
          backgroundColor: '#F6F5F2',
        },
        android: {
          package: 'com.poproom.app',
          versionCode: 1,
          adaptiveIcon: {
            foregroundImage: './assets/adaptive-icon.png',
            backgroundColor: '#E05A2B',
          },
          intentFilters: [
            { action: 'VIEW', data: [{ scheme: 'poproom' }], category: ['BROWSABLE', 'DEFAULT'] },
          ],
        },
        plugins: [
          'expo-router',
          [
            'expo-image-picker',
            {
              photosPermission: '相册权限',
              cameraPermission: '相机权限',
              microphonePermission: false,
            },
          ],
          './plugins/withAndroidMapQueries',
        ],
        extra: { eas: { projectId: '11111111-2222-3333-4444-555555555555' } },
      },
    },
    easJson: {
      build: {
        preview: {
          distribution: 'internal',
          android: { buildType: 'apk' },
        },
      },
    },
    existingAssets: [
      './assets/icon.png',
      './assets/adaptive-icon.png',
      './assets/splash-icon.png',
    ],
    migrationFiles: [
      '001_initial_schema.sql',
      '002_rls_policies.sql',
      '003_rpcs.sql',
      '004_stage2_chat_and_compliance.sql',
      '005_stage2_rpcs_and_auto_archive.sql',
      '006_announcement_acks.sql',
    ],
    localEnvConfigured: true,
  };
}

describe('evaluateReleaseReadiness', () => {
  it('passes cleanly when all Android beta requirements are satisfied', () => {
    const result = evaluateReleaseReadiness(makeValidSnapshot());
    expect(result.ok).toBe(true);
    expect(result.errors).toEqual([]);
  });

  it('fails if preview profile is not Android APK or assets are missing', () => {
    const snap = makeValidSnapshot();
    snap.easJson.build.preview.android.buildType = 'app-bundle';
    snap.existingAssets = ['./assets/icon.png'];
    const result = evaluateReleaseReadiness(snap);
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.includes('apk'))).toBe(true);
    expect(result.errors.some((e) => e.includes('adaptive-icon.png'))).toBe(true);
  });

  it('warns when extra.eas.projectId is missing in default mode, and fails in strict mode', () => {
    const snap = makeValidSnapshot();
    snap.appJson.expo.extra = {};

    const relaxed = evaluateReleaseReadiness(snap);
    expect(relaxed.ok).toBe(true);
    expect(relaxed.warnings.some((w) => w.includes('eas init'))).toBe(true);

    const strictResult = evaluateReleaseReadiness({ ...snap, strict: true });
    expect(strictResult.ok).toBe(false);
    expect(strictResult.errors.some((e) => e.includes('projectId'))).toBe(true);
  });

  it('warns loudly when local .env lacks real Supabase config and always reminds about EAS env vars', () => {
    const snap = makeValidSnapshot();
    snap.localEnvConfigured = false;
    const result = evaluateReleaseReadiness(snap);
    expect(result.warnings.some((w) => w.includes('EAS'))).toBe(true);
    expect(result.warnings.some((w) => w.includes('.env'))).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx.cmd vitest run tests/release/releaseReadiness.test.ts`
Expected: FAIL with module `../../scripts/verify-release-readiness.mjs` not found.

- [ ] **Step 3: Implement `scripts/verify-release-readiness.mjs` and `scripts/verify-release-readiness.d.mts`**

Create `scripts/verify-release-readiness.mjs` (ES module, runnable directly via `node scripts/verify-release-readiness.mjs` and importable in Vitest) plus sibling `scripts/verify-release-readiness.d.mts` exporting `ReleaseSnapshot`, `ReleaseReadinessResult`, and `evaluateReleaseReadiness` so `tsc --noEmit` stays strict-clean:
- Export `evaluateReleaseReadiness(snapshot)` checking:
  - `appJson.expo.android.package`, `version`, `versionCode >= 1`, `scheme === 'poproom'`, `icon`, `splash.image`, `android.adaptiveIcon.foregroundImage`.
  - Every referenced asset path is present in `snapshot.existingAssets`.
  - `plugins` includes `'./plugins/withAndroidMapQueries'` and `expo-image-picker` with `microphonePermission === false`.
  - `android.intentFilters` includes a `VIEW` filter for scheme `'poproom'`.
  - `easJson.build.preview.distribution === 'internal'` and `easJson.build.preview.android.buildType === 'apk'`.
  - All 6 migrations (`001` through `006`) exist in `snapshot.migrationFiles`.
  - `extra.eas.projectId`: warning in default mode ("尚未执行 `eas init` 绑定 EAS 项目 ID"), error in `strict` mode.
  - `.env` local check: warns if `localEnvConfigured` is false, and ALWAYS adds a reminder warning that `.env` is gitignored so `EXPO_PUBLIC_SUPABASE_URL` & `EXPO_PUBLIC_SUPABASE_ANON_KEY` MUST be configured via `eas env:create --environment preview` before building.
- Guard CLI execution (`if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url))`) so importing in Vitest never executes `process.exit()`.
- In CLI mode, read `app.json`, `eas.json`, check files on disk, check `.env` without ever printing secret values, print a concise green/yellow/red report, and exit `1` if `!result.ok`.

- [ ] **Step 4: Write `docs/superpowers/verification/android-beta-release-guide.md`**

Create a clear, concise Chinese release & smoke-test guide covering:
1. **一次性 EAS 账号与云端环境变量配置**：
   - 安装/调用 EAS CLI：`npx.cmd eas-cli login`、`npx.cmd eas-cli init`（会写入 `app.json` 的 `extra.eas.projectId`，提交该变更）。
   - 写入 `preview` 云端环境变量（强调 `.env` 不会上传到 EAS）：
     - `npx.cmd eas-cli env:create --environment preview --name EXPO_PUBLIC_SUPABASE_URL --value <你的 URL> --visibility plaintext`
     - `npx.cmd eas-cli env:create --environment preview --name EXPO_PUBLIC_SUPABASE_ANON_KEY --value <你的 Anon Key> --visibility plaintext`
2. **Supabase 线上核验（出包前）**：确认 `001`–`006` 迁移、`room-media` 私有存储桶、`pg_cron` 定时任务、`Confirm Email` 开关（内测阶段建议关闭或配置自定义 SMTP）。
3. **打包前自动门禁 & 出包命令**：
   - `npm.cmd run typecheck`
   - `npm.cmd test`
   - `npm.cmd run release:check -- --strict`
   - `npm.cmd run build:android:beta`（或 `npx.cmd eas-cli build --platform android --profile preview`）
4. **分发给安卓内测用户**：EAS 构建详情页二维码/下载链接，或直接下载 `.apk` 微信/飞书发送，并附「安装未知来源应用」提示与升级时递增 `app.json` 的 `android.versionCode` 说明。
5. **安卓独立 APK 专属真机冒烟清单**（与 Expo Go 行为差异项）：
   - 桌面图标、Android 自适应图标裁剪与 `#F6F5F2` 暖瓷启动屏无白闪
   - 首次注册/登录 + `我的 → 内测版本信息` 显示 `云端已连接` 及正确 `v0.1.0 · Build 1` + 一键复制诊断信息
   - 外部浏览器/备忘录点击 `poproom://room/join?code=XXXXXX` 拉起独立 App 并直达进房页
   - 复制分享口令回到 App 触发剪贴板自动识别进房
   - 任务实拍图 / 报销凭证调起相册与相机（确认无麦克风权限申请）并成功上传与预览
   - 日程轴一键唤起高德地图 / 百度地图 App（验证 `<queries>` 生效，不再强制回退网页）
   - 活动复盘导出高清 PNG 长图 & A4 PDF 并调起安卓系统分享面板
   - 聊天室软键盘弹出顶起输入框不遮挡（验证 `softwareKeyboardLayoutMode: "resize"`）
   - 强杀进程冷启动验证离线缓存 + 未读红点持久化

- [ ] **Step 5: Run full verification suite (`typecheck`, `vitest`, `release:check`)**

Run: `npm.cmd run typecheck; npm.cmd test; npm.cmd run release:check`
Expected:
- `tsc --noEmit`: 0 errors
- `vitest run`: all test files (existing 24 + 4 new = 28 test files) PASS
- `npm.cmd run release:check`: exits 0 (with clear reminder about `eas init` + EAS `preview` env vars before cloud build).

- [ ] **Step 6: Commit**

```powershell
git add scripts/verify-release-readiness.mjs scripts/verify-release-readiness.d.mts docs/superpowers/verification/android-beta-release-guide.md tests/release/releaseReadiness.test.ts
git commit -m "feat(release): add Android beta preflight gate and APK distribution runbook"
```

---

## Post-Plan Operator Handoff (Requires User's Expo Account)

Once Tasks 1–5 are complete and committed, the only remaining step to produce the downloadable `.apk` requires your interactive Expo account login:

1. `npx.cmd eas-cli login`
2. `npx.cmd eas-cli init` (links `extra.eas.projectId` in `app.json`)
3. Configure `EXPO_PUBLIC_SUPABASE_URL` & `EXPO_PUBLIC_SUPABASE_ANON_KEY` in EAS `preview` environment (`eas env:create --environment preview ...`)
4. `npm.cmd run release:check -- --strict`
5. `npm.cmd run build:android:beta` → download/share the generated Android `.apk`!
