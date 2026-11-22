import { describe, expect, it } from 'vitest';
import {
  computeSheetMaxDynamicHeight,
  resolveSheetModalTransition,
} from '../../src/lib/sheetModalHelpers';

/**
 * Minimal faithful model of `@gorhom/bottom-sheet` v5.2.14 `BottomSheetModal` statusRef:
 * Calling `dismiss()` while status is `INITIAL` leaves status stuck in `DISMISSING`,
 * causing `handlePortalRender` to silently skip rendering on every subsequent `present()`.
 */
class GorhomModalStateMachineMock {
  status: 'INITIAL' | 'PRESENTED' | 'DISMISSING' = 'INITIAL';
  renderCount = 0;

  present(): boolean {
    if (this.status === 'DISMISSING') {
      // Mirrors `handlePortalRender`: early return when status === MODAL_STATUS.DISMISSING
      return false;
    }
    this.status = 'PRESENTED';
    this.renderCount += 1;
    return true;
  }

  dismiss(onDismiss?: () => void): void {
    if (this.status === 'INITIAL') {
      // Mirrors `BottomSheetModal.handleDismiss` falling through to line 291 when unmounted
      this.status = 'DISMISSING';
      return;
    }
    this.status = 'INITIAL';
    onDismiss?.();
  }

  simulateUserBackdropClose(onDismiss: () => void): void {
    this.status = 'INITIAL';
    onDismiss();
  }
}

describe('sheetModalHelpers', () => {
  it('never issues dismiss on initial mount when visible is false', () => {
    expect(
      resolveSheetModalTransition({ visible: false, isPresented: false }),
    ).toEqual({
      command: 'none',
      nextPresented: false,
    });
  });

  it('issues present once when transitioning from hidden to visible', () => {
    expect(
      resolveSheetModalTransition({ visible: true, isPresented: false }),
    ).toEqual({
      command: 'present',
      nextPresented: true,
    });

    expect(
      resolveSheetModalTransition({ visible: true, isPresented: true }),
    ).toEqual({
      command: 'none',
      nextPresented: true,
    });
  });

  it('issues dismiss once when programmatically hiding a presented modal', () => {
    expect(
      resolveSheetModalTransition({ visible: false, isPresented: true }),
    ).toEqual({
      command: 'dismiss',
      nextPresented: false,
    });
  });

  it('keeps Gorhom BottomSheetModal openable across mount, user close, and programmatic close cycles', () => {
    const modal = new GorhomModalStateMachineMock();
    let isPresented = false;

    const sync = (visible: boolean) => {
      const step = resolveSheetModalTransition({ visible, isPresented });
      isPresented = step.nextPresented;
      if (step.command === 'present') {
        expect(modal.present()).toBe(true);
      } else if (step.command === 'dismiss') {
        modal.dismiss(() => {
          isPresented = false;
        });
      }
    };

    // 1. Initial mount with visible = false (previously bricked modal into DISMISSING)
    sync(false);
    expect(modal.status).toBe('INITIAL');

    // 2. User taps button ("发起新投票" / "添加积木" / "添加投票选项")
    sync(true);
    expect(modal.status).toBe('PRESENTED');
    expect(modal.renderCount).toBe(1);

    // 3. User dismisses via backdrop/swipe; BottomSheetModal calls onDismiss -> parent sets visible=false
    modal.simulateUserBackdropClose(() => {
      isPresented = false;
    });
    sync(false);
    expect(modal.status).toBe('INITIAL');

    // 4. User taps button a second time — must still present cleanly
    sync(true);
    expect(modal.status).toBe('PRESENTED');
    expect(modal.renderCount).toBe(2);

    // 5. Parent programmatically closes sheet after form submission
    sync(false);
    expect(modal.status).toBe('INITIAL');

    // 6. User taps button a third time — must still present cleanly
    sync(true);
    expect(modal.status).toBe('PRESENTED');
    expect(modal.renderCount).toBe(3);
  });

  it('caps max dynamic content height safely below status bar inset', () => {
    expect(computeSheetMaxDynamicHeight(844, 47)).toBe(717);
    expect(computeSheetMaxDynamicHeight(600, 120)).toBe(468);
    expect(computeSheetMaxDynamicHeight(300, 40)).toBe(248);
  });
});
