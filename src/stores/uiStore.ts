import { create } from 'zustand';

/** Visual variant for global toast banners. */
export type ToastVariant = 'info' | 'success' | 'error';

/** Queued toast payload displayed at the top of the root layout. */
export interface ToastItem {
  id: number;
  type: ToastVariant;
  message: string;
  durationMs: number;
}

interface UiStoreState {
  toast: ToastItem | null;
  queue: ToastItem[];
  showToast: (message: string, type?: ToastVariant, durationMs?: number) => void;
  dismissToast: (id?: number) => void;
}

const DEFAULT_TOAST_DURATION_MS = 2800;
let nextToastId = 1;

/** Global UI store managing a sequential FIFO banner toast queue. */
export const useUiStore = create<UiStoreState>((set, get) => ({
  toast: null,
  queue: [],

  showToast: (message, type = 'info', durationMs = DEFAULT_TOAST_DURATION_MS) => {
    const trimmed = message.trim();
    if (!trimmed) {
      return;
    }

    const { toast, queue } = get();
    if (toast && toast.message === trimmed && toast.type === type) {
      return;
    }

    const item: ToastItem = {
      id: nextToastId++,
      type,
      message: trimmed,
      durationMs,
    };

    if (!toast) {
      set({ toast: item });
      return;
    }

    set({ queue: [...queue, item] });
  },

  dismissToast: (id) => {
    const { toast, queue } = get();
    if (id !== undefined && toast?.id !== id) {
      set({ queue: queue.filter((entry) => entry.id !== id) });
      return;
    }

    const [nextToast, ...remaining] = queue;
    set({
      toast: nextToast ?? null,
      queue: remaining,
    });
  },
}));
