import { create } from 'zustand';
import { fsProvider } from '../fs';
import { StaleWriteError, type FileStat, type WatchEvent } from '../fs/types';
import { samePath } from '../lib/text';

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

/**
 * WYSIWYG is the default because the product is a formatting surface, not a text editor.
 * Source mode is the escape hatch for anything the visual schema cannot express.
 */
export type EditorMode = 'wysiwyg' | 'source';

export interface SessionState {
  doc: OpenDocument | null;
  mode: EditorMode;
  /** Set when a save was refused because the file changed on disk. */
  conflict: FileStat | null;
  /** Set when the open file disappeared from disk underneath us. */
  missing: boolean;
  busy: boolean;
  error: string | null;

  openFile: (filePath: string) => Promise<void>;
  closeFile: () => void;
  /** Follows an in-app rename, so the editor keeps its buffer and history. */
  retarget: (nextPath: string) => void;
  setText: (text: string) => void;
  setMode: (mode: EditorMode) => void;
  toggleMode: () => void;
  save: (options?: { force?: boolean }) => Promise<void>;
  reloadFromDisk: () => Promise<void>;
  applyWatchEvent: (event: WatchEvent) => void;
  reportError: (message: string) => void;
  clearError: () => void;
}

/** Monotonic across the session; only ever read through OpenDocument.revision. */
let loadCounter = 0;

/**
 * Guards the asynchronous part of handling a watcher event.
 *
 * Events for one file arrive in bursts — an atomic save is a write and a rename, which
 * the watcher reports as a change or an add followed by an unlink. Each handler stats the
 * file, and without this a stale stat resolving late would undo what a newer event had
 * already decided.
 */
let watchSequence = 0;

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export const useSession = create<SessionState>((set, get) => ({
  doc: null,
  mode: 'wysiwyg',
  conflict: null,
  missing: false,
  busy: false,
  error: null,

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
        missing: false,
        busy: false,
      });
    } catch (error) {
      set({ busy: false, error: describe(error) });
    }
  },

  closeFile: () => set({ doc: null, conflict: null, missing: false }),

  retarget: (nextPath) => {
    const doc = get().doc;
    if (!doc) return;
    set({
      doc: { ...doc, path: nextPath, baseStat: { ...doc.baseStat, path: nextPath } },
      missing: false,
    });
  },

  setText: (text) => {
    const { doc } = get();
    if (!doc || doc.text === text) return;
    set({ doc: { ...doc, text, dirty: true } });
  },

  setMode: (mode) => set({ mode }),

  toggleMode: () => set({ mode: get().mode === 'wysiwyg' ? 'source' : 'wysiwyg' }),

  save: async (options) => {
    const doc = get().doc;
    if (!doc) return;
    if (!doc.dirty && options?.force !== true) return;

    const saved = doc.text;
    set({ busy: true, error: null });
    try {
      // A missing file has no mtime to match, so recreating it is always a forced write.
      const force = options?.force === true || get().missing;
      const stat = force
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
        missing: false,
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

  /**
   * External changes to the open file.
   *
   * Our own saves produce a change event too, so the on-disk mtime is compared against
   * the baseline before anything happens — otherwise saving would reload the editor and
   * throw away the cursor position every time.
   */
  applyWatchEvent: (event) => {
    const doc = get().doc;
    if (!doc || !samePath(event.path, doc.path)) return;

    const sequence = ++watchSequence;

    if (event.event === 'unlink') {
      // A conflict with a file that no longer exists is not a conflict any more.
      set({ missing: true, conflict: null });
      return;
    }
    if (event.event !== 'change' && event.event !== 'add') return;

    void fsProvider
      .stat(doc.path)
      .then((stat) => {
        if (sequence !== watchSequence) return;

        const current = get().doc;
        if (!current || !samePath(current.path, doc.path)) return;
        set({ missing: false });

        if (Math.abs(stat.mtimeMs - current.baseStat.mtimeMs) <= 1) return;
        if (current.dirty) {
          set({ conflict: stat });
          return;
        }
        void get().reloadFromDisk();
      })
      .catch(() => {
        // The file went away between the event and the stat; the unlink event covers it.
      });
  },

  reportError: (message) => set({ error: message }),

  clearError: () => set({ error: null }),
}));
