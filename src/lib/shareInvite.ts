import { buildShareMessage } from './roomCode';
import { useUiStore } from '../stores/uiStore';

/** Parameters required to share or copy a room invitation. */
export interface ShareRoomInviteParams {
  title: string;
  roomCode: string;
  inviteUrl: string;
}

/** Result of attempting native share with clipboard fallback. */
export type ShareInviteOutcome = 'shared' | 'dismissed' | 'copied';

/** Minimal result shape returned by React Native's `Share.share`. */
export interface ShareActionResult {
  action: string;
}

/** Dependency injection contract for `executeShareWithFallback` (enables pure Node testing). */
export interface ShareInviteDeps {
  share: (content: {
    title: string;
    message: string;
  }) => Promise<ShareActionResult>;
  copy: (text: string) => Promise<void | boolean>;
  sharedAction?: string;
  dismissedAction?: string;
}

/**
 * Executes native share with graceful clipboard fallback when sharing throws or is unavailable.
 * Returns `'dismissed'` when the user explicitly cancels the OS share sheet.
 */
export async function executeShareWithFallback(
  message: string,
  title: string,
  deps: ShareInviteDeps,
): Promise<ShareInviteOutcome> {
  const sharedAction = deps.sharedAction ?? 'sharedAction';
  const dismissedAction = deps.dismissedAction ?? 'dismissedAction';

  try {
    const result = await deps.share({ title, message });
    if (result.action === dismissedAction) {
      return 'dismissed';
    }
    if (result.action === sharedAction) {
      return 'shared';
    }
  } catch {
    // Native share sheet failed or is unavailable on this platform; fall back to clipboard.
  }

  await deps.copy(message);
  return 'copied';
}

/**
 * Opens the OS native share sheet for a room invitation, falling back to `expo-clipboard` if unavailable.
 * Lazily imports React Native / Expo modules so pure helpers remain testable in Node.
 */
export async function shareRoomInvite(
  params: ShareRoomInviteParams,
): Promise<ShareInviteOutcome> {
  const message = buildShareMessage(
    params.title,
    params.roomCode,
    params.inviteUrl,
  );

  // Mark our own shared/copied room code as already handled so returning to the app
  // from WeChat/QQ never triggers an unintended clipboard auto-jump loop.
  useUiStore.getState().markClipboardCodeHandled(params.roomCode);

  return executeShareWithFallback(message, params.title, {
    share: async (content) => {
      const { Share } = await import('react-native');
      const result = await Share.share(
        { title: content.title, message: content.message },
        { dialogTitle: content.title },
      );
      if (result.action === Share.dismissedAction) {
        return { action: 'dismissedAction' };
      }
      if (result.action === Share.sharedAction) {
        return { action: 'sharedAction' };
      }
      return result;
    },
    copy: async (text) => {
      const Clipboard = await import('expo-clipboard');
      await Clipboard.setStringAsync(text);
    },
  });
}
