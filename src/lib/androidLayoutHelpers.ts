/** Normalized bottom tab bar height & bottom padding accounting for OS safe-area insets. */
export interface TabBarDimensions {
  height: number;
  paddingBottom: number;
}

/**
 * Computes safe bottom tab bar height so Android 15/16 edge-to-edge (3-button or gesture bar)
 * never shrinks the content area beneath `paddingBottom: insets.bottom`.
 */
export function computeTabBarDimensions(
  platform: string,
  bottomInset: number,
): TabBarDimensions {
  const safeBottom = Math.max(0, Math.round(bottomInset));
  const baseHeight = platform === 'ios' ? 56 : 58;
  const paddingBottom = safeBottom > 0 ? safeBottom : 6;
  return {
    height: baseHeight + paddingBottom,
    paddingBottom,
  };
}

/**
 * Selects `KeyboardAvoidingView` behavior for the room chat composer.
 * Uses `'padding'` on both iOS and Android so Android 15/16 edge-to-edge (where
 * `adjustResize` no longer shrinks the activity window) still lifts the input bar cleanly.
 */
export function getChatKeyboardAvoidingBehavior(
  platform: string,
): 'padding' | undefined {
  if (platform === 'ios' || platform === 'android') {
    return 'padding';
  }
  return undefined;
}
