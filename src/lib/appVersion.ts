/** Structured non-secret build metadata displayed in beta diagnostics and error reports. */
export interface AppBuildInfo {
  appVersion: string;
  buildNumber: string;
  platform: string;
  supabaseConfigured: boolean;
  supabaseHost: string;
}

/** Input contract for constructing `AppBuildInfo` deterministically in runtime or unit tests. */
export interface BuildAppBuildInfoParams {
  appVersion?: string | null;
  androidVersionCode?: number | string | null;
  iosBuildNumber?: string | null;
  platform: string;
  rawSupabaseUrl?: string;
  supabaseConfigured: boolean;
}

const MAX_ERROR_SUMMARY_CHARS = 240;

/**
 * Extracts only the hostname from a configured Supabase URL so diagnostics never leak
 * query parameters, API keys, or placeholder URLs.
 */
export function extractSafeSupabaseHost(rawUrl: string | undefined): string {
  const trimmed = rawUrl?.trim();
  if (!trimmed) {
    return '未配置';
  }
  if (
    trimmed.includes('your-project-ref') ||
    trimmed.includes('placeholder.supabase.co')
  ) {
    return '未配置';
  }
  try {
    const parsed = new URL(trimmed);
    return parsed.hostname || '无效地址';
  } catch {
    return '无效地址';
  }
}

/** Masks a user UUID to its first 8 characters for safe tester diagnostics sharing. */
export function maskUserIdForDiagnostics(
  userId: string | null | undefined,
): string {
  const trimmed = userId?.trim();
  if (!trimmed) {
    return '未登录';
  }
  const chars = Array.from(trimmed);
  if (chars.length <= 8) {
    return chars.join('');
  }
  return `${chars.slice(0, 8).join('')}…`;
}

/** Builds normalized `AppBuildInfo` for Android/iOS/Web builds. */
export function buildAppBuildInfo(
  params: BuildAppBuildInfoParams,
): AppBuildInfo {
  const appVersion = params.appVersion?.trim() || '0.1.0';
  const rawBuild =
    params.platform === 'android'
      ? params.androidVersionCode
      : params.platform === 'ios'
        ? params.iosBuildNumber
        : params.androidVersionCode ?? params.iosBuildNumber;

  const buildNumber =
    rawBuild !== undefined && rawBuild !== null && String(rawBuild).trim()
      ? String(rawBuild).trim()
      : '1';

  const supabaseHost = params.supabaseConfigured
    ? extractSafeSupabaseHost(params.rawSupabaseUrl)
    : '未配置';

  return {
    appVersion,
    buildNumber,
    platform: params.platform,
    supabaseConfigured: params.supabaseConfigured,
    supabaseHost,
  };
}

/** Formats a copy-ready Chinese beta diagnostics summary with zero secrets. */
export function formatBetaDiagnosticsText(
  info: AppBuildInfo,
  userId?: string | null,
): string {
  const cloudStatus = info.supabaseConfigured
    ? `已连接 (${info.supabaseHost})`
    : '未配置（请核对 EAS preview 环境变量）';

  return [
    `轻橘 PopRoom v${info.appVersion} (Build ${info.buildNumber})`,
    `平台：${info.platform}`,
    `云端状态：${cloudStatus}`,
    `用户：${maskUserIdForDiagnostics(userId)}`,
  ].join('\n');
}

/** Truncates an unknown thrown error into a concise, safe Chinese crash report for testers. */
export function formatErrorReportText(
  error: unknown,
  info: AppBuildInfo,
): string {
  let rawMessage = 'UnknownError';
  if (error instanceof Error) {
    rawMessage = `${error.name || 'Error'}: ${error.message || '未知异常'}`;
  } else if (typeof error === 'string' && error.trim()) {
    rawMessage = error.trim();
  }

  const chars = Array.from(rawMessage.replace(/\s+/g, ' ').trim());
  const summary =
    chars.length > MAX_ERROR_SUMMARY_CHARS
      ? `${chars.slice(0, MAX_ERROR_SUMMARY_CHARS - 1).join('')}…`
      : chars.join('');

  return [
    '轻橘 PopRoom 异常报告',
    `版本：v${info.appVersion} (Build ${info.buildNumber}) / ${info.platform}`,
    `云端：${info.supabaseConfigured ? info.supabaseHost : '未配置'}`,
    `详情：${summary}`,
  ].join('\n');
}

interface ExpoConstantsShape {
  expoConfig?: {
    version?: string;
    android?: { versionCode?: number };
    ios?: { buildNumber?: string };
  };
}

interface ReactNativePlatformShape {
  Platform?: { OS?: string };
}

/**
 * Reads runtime app version, build number, OS platform, and Supabase readiness safely.
 * Uses guarded runtime requires so pure helpers in this module remain Node/Vitest-safe.
 */
export function getRuntimeAppBuildInfo(): AppBuildInfo {
  let appVersion: string | undefined;
  let androidVersionCode: number | undefined;
  let iosBuildNumber: string | undefined;
  let platform = 'unknown';

  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const constantsMod = require('expo-constants') as {
      default?: ExpoConstantsShape;
    } & ExpoConstantsShape;
    const constants = constantsMod.default ?? constantsMod;
    appVersion = constants.expoConfig?.version;
    androidVersionCode = constants.expoConfig?.android?.versionCode;
    iosBuildNumber = constants.expoConfig?.ios?.buildNumber;
  } catch {
    // Fall back to defaults in non-Expo environments.
  }

  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const rnMod = require('react-native') as ReactNativePlatformShape;
    if (rnMod.Platform?.OS) {
      platform = rnMod.Platform.OS;
    }
  } catch {
    // Fall back to unknown platform in Node tests.
  }

  const rawSupabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL?.trim();
  const rawSupabaseAnonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY?.trim();
  const supabaseConfigured = Boolean(
    rawSupabaseUrl &&
      rawSupabaseAnonKey &&
      !rawSupabaseUrl.includes('your-project-ref') &&
      !rawSupabaseUrl.includes('placeholder.supabase.co') &&
      rawSupabaseAnonKey !== 'your-anon-key',
  );

  return buildAppBuildInfo({
    appVersion,
    androidVersionCode,
    iosBuildNumber,
    platform,
    rawSupabaseUrl,
    supabaseConfigured,
  });
}
