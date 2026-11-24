export interface ReleaseSnapshot {
  strict: boolean;
  appJson: {
    expo: {
      name?: string;
      slug?: string;
      version?: string;
      scheme?: string;
      icon?: string;
      splash?: {
        image?: string;
        backgroundColor?: string;
      };
      android?: {
        package?: string;
        versionCode?: number;
        adaptiveIcon?: {
          foregroundImage?: string;
          backgroundColor?: string;
        };
        intentFilters?: Array<{
          action?: string;
          data?: Array<{ scheme?: string }>;
          category?: string[];
        }>;
      };
      plugins?: Array<string | [string, Record<string, unknown>]>;
      extra?: {
        eas?: {
          projectId?: string;
        };
      };
    };
  };
  easJson: {
    build: {
      preview: {
        distribution: string;
        android: {
          buildType: string;
        };
      };
    };
  };
  existingAssets: string[];
  migrationFiles: string[];
  localEnvConfigured: boolean;
}

export interface ReleaseReadinessResult {
  ok: boolean;
  errors: string[];
  warnings: string[];
}

export function evaluateReleaseReadiness(
  snapshot: ReleaseSnapshot,
): ReleaseReadinessResult;
