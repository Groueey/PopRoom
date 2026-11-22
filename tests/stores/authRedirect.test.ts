import { beforeEach, describe, expect, it } from 'vitest';
import {
  AVATAR_COLORS,
  registerProfileFetcher,
  resolveAuthRedirect,
  useAuthStore,
} from '../../src/stores/authStore';
import { useUiStore } from '../../src/stores/uiStore';

describe('resolveAuthRedirect (Review Focus #5)', () => {
  it('returns null while auth state is still initializing', () => {
    expect(
      resolveAuthRedirect({
        initialized: false,
        hasSession: false,
        hasProfile: false,
        pendingRoomCode: null,
        currentSegment: '/(tabs)',
      }),
    ).toBeNull();

    expect(
      resolveAuthRedirect({
        initialized: false,
        hasSession: true,
        hasProfile: true,
        pendingRoomCode: 'K7M3P9',
        currentSegment: '/(auth)/login',
      }),
    ).toBeNull();
  });

  it('redirects unauthenticated users to /(auth)/login unless already on login', () => {
    expect(
      resolveAuthRedirect({
        initialized: true,
        hasSession: false,
        hasProfile: false,
        pendingRoomCode: null,
        currentSegment: '/(tabs)',
      }),
    ).toBe('/(auth)/login');

    expect(
      resolveAuthRedirect({
        initialized: true,
        hasSession: false,
        hasProfile: false,
        pendingRoomCode: 'K7M3P9',
        currentSegment: '/(tabs)',
      }),
    ).toBe('/(auth)/login');

    expect(
      resolveAuthRedirect({
        initialized: true,
        hasSession: false,
        hasProfile: false,
        pendingRoomCode: null,
        currentSegment: '/(auth)/onboarding',
      }),
    ).toBe('/(auth)/login');

    expect(
      resolveAuthRedirect({
        initialized: true,
        hasSession: false,
        hasProfile: false,
        pendingRoomCode: null,
        currentSegment: '/(auth)/login',
      }),
    ).toBeNull();
  });

  it('redirects authenticated users without profile to /(auth)/onboarding unless already there', () => {
    expect(
      resolveAuthRedirect({
        initialized: true,
        hasSession: true,
        hasProfile: false,
        pendingRoomCode: null,
        currentSegment: '/(auth)/login',
      }),
    ).toBe('/(auth)/onboarding');

    expect(
      resolveAuthRedirect({
        initialized: true,
        hasSession: true,
        hasProfile: false,
        pendingRoomCode: 'K7M3P9',
        currentSegment: '/(tabs)',
      }),
    ).toBe('/(auth)/onboarding');

    expect(
      resolveAuthRedirect({
        initialized: true,
        hasSession: true,
        hasProfile: false,
        pendingRoomCode: 'K7M3P9',
        currentSegment: '/(auth)/onboarding',
      }),
    ).toBeNull();
  });

  it('consumes pendingRoomCode and redirects to /room/join?code=... once authenticated with profile', () => {
    expect(
      resolveAuthRedirect({
        initialized: true,
        hasSession: true,
        hasProfile: true,
        pendingRoomCode: 'K7M3P9',
        currentSegment: '/(auth)/onboarding',
      }),
    ).toBe('/room/join?code=K7M3P9');

    expect(
      resolveAuthRedirect({
        initialized: true,
        hasSession: true,
        hasProfile: true,
        pendingRoomCode: 'K7M3P9',
        currentSegment: '/(tabs)',
      }),
    ).toBe('/room/join?code=K7M3P9');
  });

  it('redirects authenticated profiled users off auth routes to /(tabs) when no pendingRoomCode', () => {
    expect(
      resolveAuthRedirect({
        initialized: true,
        hasSession: true,
        hasProfile: true,
        pendingRoomCode: null,
        currentSegment: '/(auth)/login',
      }),
    ).toBe('/(tabs)');

    expect(
      resolveAuthRedirect({
        initialized: true,
        hasSession: true,
        hasProfile: true,
        pendingRoomCode: null,
        currentSegment: '/(auth)/onboarding',
      }),
    ).toBe('/(tabs)');

    expect(
      resolveAuthRedirect({
        initialized: true,
        hasSession: true,
        hasProfile: true,
        pendingRoomCode: null,
        currentSegment: undefined,
      }),
    ).toBe('/(tabs)');
  });

  it('returns null when authenticated profiled user is already on an app route such as /room/123', () => {
    expect(
      resolveAuthRedirect({
        initialized: true,
        hasSession: true,
        hasProfile: true,
        pendingRoomCode: null,
        currentSegment: '/room/123',
      }),
    ).toBeNull();

    expect(
      resolveAuthRedirect({
        initialized: true,
        hasSession: true,
        hasProfile: true,
        pendingRoomCode: null,
        currentSegment: '(tabs)/index',
      }),
    ).toBeNull();
  });

  it('exports non-empty AVATAR_COLORS presets starting with PopRoom primary tangerine', () => {
    expect(AVATAR_COLORS.length).toBeGreaterThanOrEqual(6);
    expect(AVATAR_COLORS).toContain('#F97316');
  });
});

describe('useAuthStore and useUiStore pure Node behavior', () => {
  beforeEach(() => {
    registerProfileFetcher(null);
    useAuthStore.setState({
      session: null,
      profile: null,
      initialized: false,
      pendingRoomCode: null,
    });
    useUiStore.setState({
      toast: null,
      queue: [],
    });
  });

  it('normalizes valid pendingRoomCode and rejects invalid room codes', () => {
    const store = useAuthStore.getState();
    store.setPendingRoomCode(' k7m-3p9 ');
    expect(useAuthStore.getState().pendingRoomCode).toBe('K7M3P9');

    store.setPendingRoomCode('K7M0P9');
    expect(useAuthStore.getState().pendingRoomCode).toBeNull();

    store.setPendingRoomCode('234567');
    store.clearPendingRoomCode();
    expect(useAuthStore.getState().pendingRoomCode).toBeNull();
  });

  it('loads profile cleanly via injected ProfileFetcher without native runtime imports', async () => {
    registerProfileFetcher(async (userId) => ({
      id: userId,
      nickname: '阿橘',
      avatar_color: '#F97316',
      avatar_url: null,
      expo_push_token: null,
      created_at: '2026-11-22T00:00:00Z',
      updated_at: '2026-11-22T00:00:00Z',
    }));

    const loaded = await useAuthStore.getState().refreshProfile('user-123');
    expect(loaded?.nickname).toBe('阿橘');
    expect(useAuthStore.getState().profile?.id).toBe('user-123');
  });

  it('queues and dismisses toast messages FIFO in useUiStore', () => {
    const ui = useUiStore.getState();
    ui.showToast('第一条提示', 'info');
    ui.showToast('第二条成功', 'success');

    const first = useUiStore.getState().toast;
    expect(first?.message).toBe('第一条提示');
    expect(first?.type).toBe('info');
    expect(useUiStore.getState().queue).toHaveLength(1);

    ui.dismissToast(first?.id);
    const second = useUiStore.getState().toast;
    expect(second?.message).toBe('第二条成功');
    expect(second?.type).toBe('success');
    expect(useUiStore.getState().queue).toHaveLength(0);

    ui.dismissToast(second?.id);
    expect(useUiStore.getState().toast).toBeNull();
  });
});
