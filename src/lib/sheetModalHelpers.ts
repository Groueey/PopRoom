export type SheetModalCommand = 'present' | 'dismiss' | 'none';

export interface SheetModalTransitionInput {
  visible: boolean;
  isPresented: boolean;
}

export interface SheetModalTransitionResult {
  command: SheetModalCommand;
  nextPresented: boolean;
}

/**
 * Pure transition helper for declarative `SheetModal` over `@gorhom/bottom-sheet`'s
 * imperative `BottomSheetModal` ref.
 *
 * Crucially prevents calling `dismiss()` while the underlying modal is unmounted
 * (`MODAL_STATUS.INITIAL`), which in `@gorhom/bottom-sheet` v5 transitions `statusRef`
 * into a stuck `MODAL_STATUS.DISMISSING` state that blocks all future `present()` calls.
 */
export function resolveSheetModalTransition({
  visible,
  isPresented,
}: SheetModalTransitionInput): SheetModalTransitionResult {
  if (visible && !isPresented) {
    return { command: 'present', nextPresented: true };
  }
  if (!visible && isPresented) {
    return { command: 'dismiss', nextPresented: false };
  }
  return { command: 'none', nextPresented: isPresented };
}

/**
 * Computes a safe `maxDynamicContentSize` for dynamic-height bottom sheets so tall forms
 * remain scrollable and never collide with the top safe-area inset.
 */
export function computeSheetMaxDynamicHeight(
  windowHeight: number,
  topInset: number,
): number {
  const safeAvailable = Math.max(200, Math.round(windowHeight - topInset - 12));
  const preferredCap = Math.round(windowHeight * 0.85);
  return Math.min(preferredCap, safeAvailable);
}
