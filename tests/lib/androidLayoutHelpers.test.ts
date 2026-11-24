import { describe, expect, it } from 'vitest';
import {
  computeTabBarDimensions,
  getChatKeyboardAvoidingBehavior,
} from '../../src/lib/androidLayoutHelpers';

describe('androidLayoutHelpers (Android 15+ edge-to-edge safety)', () => {
  it('adds bottom safe-area inset on Android so 3-button nav bars never clip tab labels', () => {
    expect(computeTabBarDimensions('android', 48)).toEqual({
      height: 106,
      paddingBottom: 48,
    });
    expect(computeTabBarDimensions('android', 0)).toEqual({
      height: 64,
      paddingBottom: 6,
    });
  });

  it('adds bottom safe-area inset cleanly on iOS and web', () => {
    expect(computeTabBarDimensions('ios', 34)).toEqual({
      height: 90,
      paddingBottom: 34,
    });
    expect(computeTabBarDimensions('web', 0)).toEqual({
      height: 64,
      paddingBottom: 6,
    });
  });

  it('uses padding keyboard avoidance on Android and iOS for edge-to-edge chat composer safety', () => {
    expect(getChatKeyboardAvoidingBehavior('android')).toBe('padding');
    expect(getChatKeyboardAvoidingBehavior('ios')).toBe('padding');
    expect(getChatKeyboardAvoidingBehavior('web')).toBeUndefined();
  });
});
