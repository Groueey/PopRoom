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
    expect(
      extractSafeSupabaseHost('https://abc123.supabase.co/rest/v1?apikey=secret'),
    ).toBe('abc123.supabase.co');
    expect(
      extractSafeSupabaseHost('https://your-project-ref.supabase.co'),
    ).toBe('未配置');
    expect(extractSafeSupabaseHost('https://placeholder.supabase.co')).toBe(
      '未配置',
    );
    expect(extractSafeSupabaseHost('')).toBe('未配置');
    expect(extractSafeSupabaseHost('not-a-url')).toBe('无效地址');
  });

  it('maskUserIdForDiagnostics keeps only first 8 chars or returns 未登录', () => {
    expect(
      maskUserIdForDiagnostics('12345678-aaaa-bbbb-cccc-1234567890ab'),
    ).toBe('12345678…');
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
