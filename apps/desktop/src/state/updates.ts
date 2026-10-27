import { create } from 'zustand';

export type UpdateStatus = 'idle' | 'checking' | 'available' | 'installing' | 'none' | 'error';

export interface UpdatesState {
  status: UpdateStatus;
  version: string | null;
  notes: string | null;
  message: string | null;

  check: () => Promise<void>;
  install: () => Promise<void>;
  dismiss: () => void;
}

/** Held between check and install, because the handle is what performs the download. */
let pending: { version: string; downloadAndInstall: () => Promise<void> } | null = null;

function inDesktopApp(): boolean {
  return typeof window !== 'undefined' && window.__TAURI_INTERNALS__ !== undefined;
}

/**
 * Checking is automatic only when asked for; installing never is.
 *
 * Replacing the running application is not something to do behind someone's back, so the
 * check reports what it found and the install waits for a second, explicit yes.
 */
export const useUpdates = create<UpdatesState>((set) => ({
  status: 'idle',
  version: null,
  notes: null,
  message: null,

  check: async () => {
    if (!inDesktopApp()) {
      set({ status: 'none', message: 'Updates are only available in the desktop app.' });
      return;
    }

    set({ status: 'checking', message: null });
    try {
      const { check } = await import('@tauri-apps/plugin-updater');
      const update = await check();

      if (!update) {
        pending = null;
        set({ status: 'none', version: null, message: 'This is the latest version.' });
        return;
      }

      pending = { version: update.version, downloadAndInstall: () => update.downloadAndInstall() };
      set({
        status: 'available',
        version: update.version,
        notes: update.body ?? null,
        message: null,
      });
    } catch (error) {
      pending = null;
      // The common case is a build with no update endpoint configured, which is not a
      // failure worth alarming anyone about.
      set({
        status: 'error',
        message:
          'Could not check for updates. This build may not have an update server configured.',
      });
      void error;
    }
  },

  install: async () => {
    if (pending === null) return;

    set({ status: 'installing', message: null });
    try {
      await pending.downloadAndInstall();
      const { relaunch } = await import('@tauri-apps/plugin-process');
      await relaunch();
    } catch (error) {
      set({
        status: 'error',
        message: error instanceof Error ? error.message : String(error),
      });
    }
  },

  dismiss: () => set({ status: 'idle', message: null }),
}));
