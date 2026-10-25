import { create } from 'zustand';
import { fsProvider } from '../fs';
import { StaleWriteError, type DirEntry, type FileStat } from '../fs/types';

export interface OpenDocument {
  path: string;
  text: string;
  /** Stat as of the last successful read or write: the baseline for conflict detection. */
  baseStat: FileStat;
  dirty: boolean;
  /**
   * Bumped on every load from disk. The editor keys its view off this, so reopening or
   * reloading the same path replaces the buffer instead of leaving a stale one on screen.
   */
  revision: number;
}

/** Monotonic across the session; only ever read through OpenDocument.revision. */
let loadCounter = 0;

export interface SessionState {
  roots: string[];
  dirPath: string | null;
  entries: DirEntry[];
  doc: OpenDocument | null;
  /** Set when a save was refused because the file changed on disk. */
  conflict: FileStat | null;
  busy: boolean;
  error: string | null;

  init: () => Promise<void>;
  openDir: (dirPath: string) => Promise<void>;
  openFile: (filePath: string) => Promise<void>;
  setText: (text: string) => void;
  save: (options?: { force?: boolean }) => Promise<void>;
  reloadFromDisk: () => Promise<void>;
  clearError: () => void;
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export const useSession = create<SessionState>((set, get) => ({
  roots: [],
  dirPath: null,
  entries: [],
  doc: null,
  conflict: null,
  busy: false,
  error: null,

  init: async () => {
    set({ busy: true, error: null });
    try {
      const roots = await fsProvider.roots();
      set({ roots, busy: false });

      const first = roots[0];
      if (first !== undefined) {
        await get().openDir(first);
      }
    } catch (error) {
      set({ busy: false, error: describe(error) });
    }
  },

  openDir: async (dirPath) => {
    set({ busy: true, error: null });
    try {
      const entries = await fsProvider.listDir(dirPath);
      set({ dirPath, entries, busy: false });
    } catch (error) {
      set({ busy: false, error: describe(error) });
    }
  },

  openFile: async (filePath) => {
    set({ busy: true, error: null });
    try {
      const contents = await fsProvider.readFile(filePath);
      set({
        doc: {
          path: contents.path,
          text: contents.text,
          baseStat: contents.stat,
          dirty: false,
          revision: ++loadCounter,
        },
        conflict: null,
        busy: false,
      });
    } catch (error) {
      set({ busy: false, error: describe(error) });
    }
  },

  setText: (text) => {
    const { doc } = get();
    if (!doc || doc.text === text) return;
    set({ doc: { ...doc, text, dirty: true } });
  },

  save: async (options) => {
    const doc = get().doc;
    if (!doc) return;
    if (!doc.dirty && options?.force !== true) return;

    const saved = doc.text;
    set({ busy: true, error: null });
    try {
      const stat =
        options?.force === true
          ? await fsProvider.writeFile(doc.path, saved)
          : await fsProvider.writeFile(doc.path, saved, {
              expectedMtimeMs: doc.baseStat.mtimeMs,
            });

      // The user may have kept typing while the write was in flight.
      const current = get().doc;
      if (!current || current.path !== doc.path) {
        set({ busy: false });
        return;
      }
      set({
        doc: { ...current, baseStat: stat, dirty: current.text !== saved },
        conflict: null,
        busy: false,
      });
    } catch (error) {
      if (error instanceof StaleWriteError) {
        set({ busy: false, conflict: error.current });
        return;
      }
      set({ busy: false, error: describe(error) });
    }
  },

  reloadFromDisk: async () => {
    const doc = get().doc;
    if (!doc) return;
    await get().openFile(doc.path);
  },

  clearError: () => set({ error: null }),
}));
