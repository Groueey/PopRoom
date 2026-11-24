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
        return (
          filter.action === 'VIEW' && data?.some((d) => d.scheme === 'poproom')
        );
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
        development: {
          developmentClient: boolean;
          android: { buildType: string };
        };
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
    addMapQueriesToManifest(manifest);

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
        (item) =>
          item.action?.[0]?.$?.['android:name'] === 'android.intent.action.VIEW',
      ),
    ).toBe(true);
  });
});
