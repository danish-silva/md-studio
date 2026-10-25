import { create } from 'zustand';
import { fsProvider } from '../fs';
import { StaleWriteError, type FileStat, type WatchEvent } from '../fs/types';
import { dropCachedStates } from '../lib/editor-cache';
import { isInside, samePath } from '../lib/text';

/**
 * WYSIWYG is the default because the product is a formatting surface, not a text editor.
 * Source mode is the escape hatch for anything the visual schema cannot express.
 */
export type EditorMode = 'wysiwyg' | 'source';

export interface OpenDocument {
  path: string;
  text: string;
  /** The text as it stands on disk, so `dirty` can mean "differs" rather than "touched". */
  savedText: string;
  /** Stat as of the last successful read or write: the baseline for conflict detection. */
  baseStat: FileStat;
  dirty: boolean;
  /**
   * Bumped on every load from disk. The editor keys its view off this, so reloading the
   * same path replaces the buffer instead of leaving a stale one on screen.
   */
  revision: number;
  mode: EditorMode;
  /** The file disappeared from disk while it was open. */
  missing: boolean;
  /** A save was refused because the file changed on disk. */
  conflict: FileStat | null;
  pinned: boolean;
  lastActiveAt: number;
}

export interface ClosedTab {
  path: string;
  closedAt: number;
}

export interface TabGroup {
  /** The workspace folder the files belong to, or null when it is outside every root. */
  root: string | null;
  label: string;
  paths: string[];
}

export interface TabSections {
  pinned: string[];
  groups: TabGroup[];
}

const RECENTLY_CLOSED_LIMIT = 12;
const DAY_MS = 24 * 60 * 60 * 1000;

export interface DocumentsState {
  order: string[];
  byPath: Record<string, OpenDocument>;
  activePath: string | null;
  recentlyClosed: ClosedTab[];
  /** 0 disables archiving. */
  autoArchiveDays: number;
  /** A tab asked to close while it had unsaved changes. */
  pendingClose: string | null;
  busy: boolean;
  error: string | null;

  open: (path: string) => Promise<void>;
  activate: (path: string) => void;
  activateRelative: (delta: 1 | -1) => void;
  requestClose: (path: string) => void;
  resolveClose: (action: 'save' | 'discard' | 'cancel') => void;
  reopen: (path: string) => Promise<void>;
  clearRecentlyClosed: () => void;

  togglePin: (path: string) => void;
  reorder: (source: string, target: string) => void;

  setText: (path: string, text: string) => void;
  setMode: (path: string, mode: EditorMode) => void;
  toggleMode: () => void;

  save: (path?: string, options?: { force?: boolean }) => Promise<void>;
  saveAll: () => Promise<void>;
  reloadFromDisk: (path: string) => Promise<void>;

  retarget: (from: string, to: string) => void;
  applyWatchEvent: (event: WatchEvent) => void;
  archiveStale: (now?: number) => void;
  setAutoArchiveDays: (days: number) => void;

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
const watchSequence = new Map<string, number>();

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export const useDocuments = create<DocumentsState>((set, get) => ({
  order: [],
  byPath: {},
  activePath: null,
  recentlyClosed: [],
  autoArchiveDays: 7,
  pendingClose: null,
  busy: false,
  error: null,

  open: async (path) => {
    const existing = get().byPath[path];
    if (existing) {
      get().activate(path);
      return;
    }

    set({ busy: true, error: null });
    try {
      const contents = await fsProvider.readFile(path);
      const doc: OpenDocument = {
        path: contents.path,
        text: contents.text,
        savedText: contents.text,
        baseStat: contents.stat,
        dirty: false,
        revision: ++loadCounter,
        mode: 'wysiwyg',
        missing: false,
        conflict: null,
        pinned: false,
        lastActiveAt: Date.now(),
      };

      set({
        byPath: { ...get().byPath, [doc.path]: doc },
        order: [...get().order.filter((entry) => entry !== doc.path), doc.path],
        activePath: doc.path,
        recentlyClosed: get().recentlyClosed.filter((tab) => !samePath(tab.path, doc.path)),
        busy: false,
      });
    } catch (error) {
      set({ busy: false, error: describe(error) });
    }
  },

  activate: (path) => {
    const doc = get().byPath[path];
    if (!doc) return;
    set({
      activePath: path,
      byPath: { ...get().byPath, [path]: { ...doc, lastActiveAt: Date.now() } },
    });
  },

  activateRelative: (delta) => {
    const { order, activePath } = get();
    if (order.length === 0) return;

    const index = activePath === null ? -1 : order.indexOf(activePath);
    const next = order[(index + delta + order.length) % order.length];
    if (next !== undefined) get().activate(next);
  },

  requestClose: (path) => {
    const doc = get().byPath[path];
    if (!doc) return;
    // Closing is the one place unsaved work can vanish, so it asks first.
    if (doc.dirty) {
      set({ pendingClose: path });
      return;
    }
    closeNow(path, set, get);
  },

  resolveClose: (action) => {
    const path = get().pendingClose;
    if (path === null) return;

    if (action === 'cancel') {
      set({ pendingClose: null });
      return;
    }
    if (action === 'discard') {
      set({ pendingClose: null });
      closeNow(path, set, get);
      return;
    }

    set({ pendingClose: null });
    void get()
      .save(path)
      .then(() => {
        if (get().byPath[path]?.dirty === false) closeNow(path, set, get);
      });
  },

  reopen: async (path) => {
    set({ recentlyClosed: get().recentlyClosed.filter((tab) => !samePath(tab.path, path)) });
    await get().open(path);
  },

  clearRecentlyClosed: () => set({ recentlyClosed: [] }),

  togglePin: (path) => {
    const doc = get().byPath[path];
    if (!doc) return;
    set({ byPath: { ...get().byPath, [path]: { ...doc, pinned: !doc.pinned } } });
  },

  reorder: (source, target) => {
    const { byPath } = get();
    const from = byPath[source];
    const to = byPath[target];
    if (!from || !to || source === target) return;

    // A tab's group follows the file's folder, so it cannot be dragged into another one.
    if (from.pinned !== to.pinned) return;
    set({ order: reorderPaths(get().order, source, target) });
  },

  setText: (path, text) => {
    const doc = get().byPath[path];
    if (!doc || doc.text === text) return;
    // Undoing back to what is on disk leaves nothing to save.
    set({ byPath: { ...get().byPath, [path]: { ...doc, text, dirty: text !== doc.savedText } } });
  },

  setMode: (path, mode) => {
    const doc = get().byPath[path];
    if (!doc || doc.mode === mode) return;
    set({ byPath: { ...get().byPath, [path]: { ...doc, mode } } });
  },

  toggleMode: () => {
    const { activePath, byPath } = get();
    if (activePath === null) return;
    const doc = byPath[activePath];
    if (!doc) return;
    get().setMode(activePath, doc.mode === 'wysiwyg' ? 'source' : 'wysiwyg');
  },

  save: async (path, options) => {
    const target = path ?? get().activePath;
    if (target === null) return;

    const doc = get().byPath[target];
    if (!doc) return;
    if (!doc.dirty && options?.force !== true) return;

    const saved = doc.text;
    set({ busy: true, error: null });
    try {
      // A missing file has no mtime to match, so recreating it is always a forced write.
      const force = options?.force === true || doc.missing;
      const stat = force
        ? await fsProvider.writeFile(doc.path, saved)
        : await fsProvider.writeFile(doc.path, saved, {
            expectedMtimeMs: doc.baseStat.mtimeMs,
          });

      // The user may have kept typing while the write was in flight.
      const current = get().byPath[target];
      if (!current) {
        set({ busy: false });
        return;
      }
      patch(set, get, target, {
        savedText: saved,
        baseStat: stat,
        dirty: current.text !== saved,
        conflict: null,
        missing: false,
      });
      set({ busy: false });
    } catch (error) {
      if (error instanceof StaleWriteError) {
        patch(set, get, target, { conflict: error.current });
        set({ busy: false });
        return;
      }
      set({ busy: false, error: describe(error) });
    }
  },

  saveAll: async () => {
    for (const path of get().order) {
      if (get().byPath[path]?.dirty === true) await get().save(path);
    }
  },

  reloadFromDisk: async (path) => {
    const doc = get().byPath[path];
    if (!doc) return;

    try {
      const contents = await fsProvider.readFile(path);
      patch(set, get, path, {
        text: contents.text,
        savedText: contents.text,
        baseStat: contents.stat,
        dirty: false,
        revision: ++loadCounter,
        conflict: null,
        missing: false,
      });
    } catch (error) {
      set({ error: describe(error) });
    }
  },

  retarget: (from, to) => {
    const doc = get().byPath[from];
    if (!doc) return;

    const byPath = { ...get().byPath };
    delete byPath[from];
    byPath[to] = { ...doc, path: to, baseStat: { ...doc.baseStat, path: to }, missing: false };

    set({
      byPath,
      order: get().order.map((entry) => (entry === from ? to : entry)),
      activePath: get().activePath === from ? to : get().activePath,
    });
  },

  /**
   * External changes to an open file.
   *
   * Our own saves produce a change event too, so the on-disk mtime is compared against
   * the baseline before anything happens — otherwise saving would reload the editor and
   * throw away the cursor position every time.
   */
  applyWatchEvent: (event) => {
    const match = get().order.find((path) => samePath(path, event.path));
    if (match === undefined) return;

    const sequence = (watchSequence.get(match) ?? 0) + 1;
    watchSequence.set(match, sequence);

    if (event.event === 'unlink') {
      // A conflict with a file that no longer exists is not a conflict any more.
      patch(set, get, match, { missing: true, conflict: null });
      return;
    }
    if (event.event !== 'change' && event.event !== 'add') return;

    void fsProvider
      .stat(match)
      .then((stat) => {
        if (watchSequence.get(match) !== sequence) return;

        const current = get().byPath[match];
        if (!current) return;
        patch(set, get, match, { missing: false });

        if (Math.abs(stat.mtimeMs - current.baseStat.mtimeMs) <= 1) return;
        if (current.dirty) {
          patch(set, get, match, { conflict: stat });
          return;
        }
        void get().reloadFromDisk(match);
      })
      .catch(() => {
        // The file went away between the event and the stat; the unlink event covers it.
      });
  },

  archiveStale: (now = Date.now()) => {
    const { order, byPath, activePath, autoArchiveDays } = get();
    const stale = staleTabs({ order, byPath, activePath, days: autoArchiveDays, now });

    for (const path of stale) closeNow(path, set, get);
  },

  setAutoArchiveDays: (days) => set({ autoArchiveDays: Math.max(0, days) }),

  reportError: (message) => set({ error: message }),
  clearError: () => set({ error: null }),
}));

type Setter = (partial: Partial<DocumentsState>) => void;
type Getter = () => DocumentsState;

function patch(set: Setter, get: Getter, path: string, changes: Partial<OpenDocument>): void {
  const doc = get().byPath[path];
  if (!doc) return;
  set({ byPath: { ...get().byPath, [path]: { ...doc, ...changes } } });
}

function closeNow(path: string, set: Setter, get: Getter): void {
  const { order, byPath, activePath, recentlyClosed } = get();
  if (!byPath[path]) return;

  const index = order.indexOf(path);
  const nextOrder = order.filter((entry) => entry !== path);
  const nextByPath = { ...byPath };
  delete nextByPath[path];
  dropCachedStates(path);

  // Hand focus to the neighbour on the left, the way a tab strip does.
  const nextActive =
    activePath === path ? (nextOrder[Math.max(0, index - 1)] ?? null) : activePath;

  set({
    order: nextOrder,
    byPath: nextByPath,
    activePath: nextActive,
    recentlyClosed: [
      { path, closedAt: Date.now() },
      ...recentlyClosed.filter((tab) => !samePath(tab.path, path)),
    ].slice(0, RECENTLY_CLOSED_LIMIT),
  });
}

/** Moves `source` to where `target` currently sits. */
export function reorderPaths(order: readonly string[], source: string, target: string): string[] {
  const without = order.filter((entry) => entry !== source);
  const at = without.indexOf(target);
  if (at < 0) return [...order];

  const sourceIndex = order.indexOf(source);
  const targetIndex = order.indexOf(target);
  const insertAt = sourceIndex < targetIndex ? at + 1 : at;

  return [...without.slice(0, insertAt), source, ...without.slice(insertAt)];
}

/** The deepest workspace folder containing this file. */
export function rootFor(path: string, roots: readonly string[]): string | null {
  let best: string | null = null;
  for (const root of roots) {
    if (!isInside(root, path)) continue;
    if (best === null || root.length > best.length) best = root;
  }
  return best;
}

/**
 * Tabs as the sidebar draws them: a pinned zone that spans every folder, then one group
 * per workspace folder, in the order the folders were added.
 */
export function sectionTabs(
  order: readonly string[],
  byPath: Readonly<Record<string, OpenDocument>>,
  roots: readonly string[],
): TabSections {
  const pinned: string[] = [];
  const grouped = new Map<string, string[]>();
  const loose: string[] = [];

  for (const path of order) {
    const doc = byPath[path];
    if (!doc) continue;
    if (doc.pinned) {
      pinned.push(path);
      continue;
    }

    const root = rootFor(path, roots);
    if (root === null) {
      loose.push(path);
      continue;
    }
    grouped.set(root, [...(grouped.get(root) ?? []), path]);
  }

  const groups: TabGroup[] = roots
    .filter((root) => (grouped.get(root)?.length ?? 0) > 0)
    .map((root) => ({ root, label: labelOf(root), paths: grouped.get(root) ?? [] }));

  if (loose.length > 0) {
    groups.push({ root: null, label: 'Other', paths: loose });
  }
  return { pinned, groups };
}

function labelOf(root: string): string {
  const segments = root.split(/[\\/]/).filter((segment) => segment.length > 0);
  return segments[segments.length - 1] ?? root;
}

export interface StaleInput {
  order: readonly string[];
  byPath: Readonly<Record<string, OpenDocument>>;
  activePath: string | null;
  days: number;
  now: number;
}

/**
 * Tabs that have sat untouched long enough to archive. Pinned, unsaved and active tabs
 * are never archived — the point is to clear forgotten tabs, not to lose anything.
 */
export function staleTabs({ order, byPath, activePath, days, now }: StaleInput): string[] {
  if (days <= 0) return [];
  const cutoff = now - days * DAY_MS;

  return order.filter((path) => {
    const doc = byPath[path];
    if (!doc) return false;
    if (doc.pinned || doc.dirty) return false;
    if (activePath !== null && samePath(activePath, path)) return false;
    return doc.lastActiveAt < cutoff;
  });
}
