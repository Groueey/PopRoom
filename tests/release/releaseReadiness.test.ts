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
            {
              action: 'VIEW',
              data: [{ scheme: 'poproom' }],
              category: ['BROWSABLE', 'DEFAULT'],
            },
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
    expect(result.errors.some((e) => e.includes('adaptive-icon.png'))).toBe(
      true,
    );
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
