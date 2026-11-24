import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

const REQUIRED_MIGRATION_PREFIXES = [
  '001_',
  '002_',
  '003_',
  '004_',
  '005_',
  '006_',
];

/**
 * Pure evaluator checking Android standalone beta APK release readiness.
 * Never reads or returns secret values.
 */
export function evaluateReleaseReadiness(snapshot) {
  const errors = [];
  const warnings = [];

  const expo = snapshot?.appJson?.expo;
  if (!expo || typeof expo !== 'object') {
    errors.push('app.json 缺少 expo 根节点');
    return { ok: false, errors, warnings };
  }

  if (typeof expo.version !== 'string' || !expo.version.trim()) {
    errors.push('app.json 缺少有效的 expo.version');
  }

  if (expo.scheme !== 'poproom') {
    errors.push('app.json 的 expo.scheme 必须为 "poproom"');
  }

  const android = expo.android;
  if (!android || typeof android !== 'object') {
    errors.push('app.json 缺少 expo.android 配置');
  } else {
    if (typeof android.package !== 'string' || !android.package.trim()) {
      errors.push('app.json 缺少 expo.android.package');
    }
    if (typeof android.versionCode !== 'number' || android.versionCode < 1) {
      errors.push('app.json 的 expo.android.versionCode 必须为 >= 1 的整数');
    }

    const intentFilters = Array.isArray(android.intentFilters)
      ? android.intentFilters
      : [];
    const hasPoproomIntent = intentFilters.some(
      (filter) =>
        filter?.action === 'VIEW' &&
        Array.isArray(filter?.data) &&
        filter.data.some((d) => d?.scheme === 'poproom'),
    );
    if (!hasPoproomIntent) {
      errors.push(
        'app.json 缺少 poproom:// 的 Android VIEW intentFilters（外部链接将无法直达进房页）',
      );
    }
  }

  const requiredAssets = [
    { label: 'expo.icon', value: expo.icon },
    { label: 'expo.splash.image', value: expo.splash?.image },
    {
      label: 'expo.android.adaptiveIcon.foregroundImage',
      value: android?.adaptiveIcon?.foregroundImage,
    },
  ];
  const existingSet = new Set(snapshot.existingAssets ?? []);
  for (const asset of requiredAssets) {
    if (typeof asset.value !== 'string' || !asset.value.trim()) {
      errors.push(`app.json 缺少 ${asset.label}`);
    } else if (!existingSet.has(asset.value)) {
      errors.push(`资产文件缺失或非有效 PNG：${asset.value} (${asset.label})`);
    }
  }

  const plugins = Array.isArray(expo.plugins) ? expo.plugins : [];
  if (!plugins.includes('./plugins/withAndroidMapQueries')) {
    errors.push(
      'app.json 缺少 ./plugins/withAndroidMapQueries 插件（Android 11+ 将无法检测高德/百度地图）',
    );
  }

  const imagePickerPlugin = plugins.find(
    (entry) => Array.isArray(entry) && entry[0] === 'expo-image-picker',
  );
  if (!imagePickerPlugin) {
    errors.push('app.json 缺少 expo-image-picker 插件配置');
  } else {
    const pickerOpts = imagePickerPlugin[1] ?? {};
    if (pickerOpts.microphonePermission !== false) {
      errors.push(
        'expo-image-picker 需设置 microphonePermission: false 以移除不必要的 Android 录音权限',
      );
    }
  }

  const previewProfile = snapshot?.easJson?.build?.preview;
  if (!previewProfile || typeof previewProfile !== 'object') {
    errors.push('eas.json 缺少 build.preview 配置');
  } else {
    if (previewProfile.distribution !== 'internal') {
      errors.push('eas.json 的 build.preview.distribution 必须为 "internal"');
    }
    if (previewProfile.android?.buildType !== 'apk') {
      errors.push(
        'eas.json 的 build.preview.android.buildType 必须为 "apk"（内测直装包）',
      );
    }
  }

  const migrations = Array.isArray(snapshot.migrationFiles)
    ? snapshot.migrationFiles
    : [];
  for (const prefix of REQUIRED_MIGRATION_PREFIXES) {
    if (!migrations.some((file) => file.startsWith(prefix))) {
      errors.push(`supabase/migrations 缺少 ${prefix}*.sql 迁移脚本`);
    }
  }

  const projectId = expo.extra?.eas?.projectId;
  if (typeof projectId !== 'string' || !projectId.trim()) {
    const msg =
      'app.json 尚未配置 extra.eas.projectId（云端出包前请先运行 `eas init` 或 `npx.cmd eas-cli init`）';
    if (snapshot.strict) {
      errors.push(msg);
    } else {
      warnings.push(msg);
    }
  }

  if (!snapshot.localEnvConfigured) {
    warnings.push(
      '本地 .env 缺少有效的 EXPO_PUBLIC_SUPABASE_URL 或 EXPO_PUBLIC_SUPABASE_ANON_KEY',
    );
  }

  warnings.push(
    '注意：.env 已被 .gitignore 忽略不会上传至 EAS 云端，出包前请务必确认已通过 `eas env:create --environment preview` 配置 Supabase 环境变量',
  );

  return {
    ok: errors.length === 0,
    errors,
    warnings,
  };
}

function isValidPngOnDisk(absPath) {
  if (!fs.existsSync(absPath)) {
    return false;
  }
  const fd = fs.openSync(absPath, 'r');
  try {
    const header = Buffer.alloc(8);
    const bytesRead = fs.readSync(fd, header, 0, 8, 0);
    return bytesRead === 8 && header.equals(PNG_SIGNATURE);
  } finally {
    fs.closeSync(fd);
  }
}

function checkLocalEnvConfigured(rootDir) {
  const envPath = path.join(rootDir, '.env');
  if (!fs.existsSync(envPath)) {
    return false;
  }
  const content = fs.readFileSync(envPath, 'utf8');
  const map = new Map();
  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) {
      continue;
    }
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx === -1) {
      continue;
    }
    const key = trimmed.slice(0, eqIdx).trim();
    const val = trimmed
      .slice(eqIdx + 1)
      .trim()
      .replace(/^["']|["']$/g, '');
    map.set(key, val);
  }
  const url = map.get('EXPO_PUBLIC_SUPABASE_URL') ?? '';
  const anonKey = map.get('EXPO_PUBLIC_SUPABASE_ANON_KEY') ?? '';
  return Boolean(
    url &&
      anonKey &&
      !url.includes('your-project-ref') &&
      !url.includes('placeholder.supabase.co') &&
      anonKey !== 'your-anon-key',
  );
}

function runCli() {
  const rootDir = process.cwd();
  const strict = process.argv.includes('--strict');

  const appJsonPath = path.join(rootDir, 'app.json');
  const easJsonPath = path.join(rootDir, 'eas.json');
  const migrationsDir = path.join(rootDir, 'supabase', 'migrations');

  const appJson = fs.existsSync(appJsonPath)
    ? JSON.parse(fs.readFileSync(appJsonPath, 'utf8'))
    : null;
  const easJson = fs.existsSync(easJsonPath)
    ? JSON.parse(fs.readFileSync(easJsonPath, 'utf8'))
    : null;

  const candidateAssets = [
    appJson?.expo?.icon,
    appJson?.expo?.splash?.image,
    appJson?.expo?.android?.adaptiveIcon?.foregroundImage,
  ].filter((v) => typeof v === 'string' && v.trim().length > 0);

  const existingAssets = candidateAssets.filter((relPath) =>
    isValidPngOnDisk(path.resolve(rootDir, relPath)),
  );

  const migrationFiles = fs.existsSync(migrationsDir)
    ? fs.readdirSync(migrationsDir).filter((f) => f.endsWith('.sql'))
    : [];

  const result = evaluateReleaseReadiness({
    strict,
    appJson,
    easJson,
    existingAssets,
    migrationFiles,
    localEnvConfigured: checkLocalEnvConfigured(rootDir),
  });

  console.log(
    `\n[PopRoom Release Check] 模式：${strict ? 'STRICT（云端出包强校验）' : 'STANDARD（本地预检）'}`,
  );

  if (result.errors.length > 0) {
    console.error('\n❌ 未通过项（必须修复）：');
    for (const err of result.errors) {
      console.error(`  - ${err}`);
    }
  }

  if (result.warnings.length > 0) {
    console.warn('\n⚠️  注意事项：');
    for (const warn of result.warnings) {
      console.warn(`  - ${warn}`);
    }
  }

  if (result.ok) {
    console.log('\n✅ 安卓内测版配置预检通过。\n');
    process.exit(0);
  } else {
    console.error('\n⛔ 预检未通过，请先修复上述错误后再执行构建。\n');
    process.exit(1);
  }
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  runCli();
}
