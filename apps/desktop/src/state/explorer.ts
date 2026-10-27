import { create } from 'zustand';
import { fsProvider } from '../fs';
import type { DirEntry, EntryKind, WatchEvent } from '../fs/types';
import { basename, isInside, isMarkdownPath, joinPath, parentDir, samePath } from '../lib/text';

export interface DirectoryState {
  entries: DirEntry[];
  loading: boolean;
  error: string | null;
}

export interface TreeRow {
  path: string;
  name: string;
  kind: EntryKind;
  /** Indentation level; roots are 0. */
  depth: number;
  root: string;
  isRoot: boolean;
  expanded: boolean;
  loading: boolean;
}

export interface TreeInput {
  roots: string[];
  directories: Record<string, DirectoryState>;
  expanded: string[];
  filter: string;
  markdownOnly: boolean;
  showHidden: boolean;
}

export interface ExplorerState extends TreeInput {
  error: string | null;

  init: () => Promise<void>;
  addRoot: (dirPath: string) => Promise<void>;
  removeRoot: (dirPath: string) => Promise<void>;

  loadDir: (dirPath: string) => Promise<void>;
  toggle: (dirPath: string) => Promise<void>;
  expand: (dirPath: string) => Promise<void>;
  collapseAll: () => void;

  setFilter: (value: string) => void;
  setMarkdownOnly: (value: boolean) => void;
  setShowHidden: (value: boolean) => void;

  createFile: (parent: string, name: string) => Promise<string | null>;
  createFolder: (parent: string, name: string) => Promise<void>;
  renameEntry: (target: string, nextName: string) => Promise<string | null>;
  trashEntry: (target: string) => Promise<void>;
  moveEntry: (source: string, destinationDir: string) => Promise<string | null>;

  applyWatchEvent: (event: WatchEvent) => void;
  clearError: () => void;
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Watcher events arrive in bursts — a save, a git checkout, a sync client. Collect the
 * affected directories and reload each once.
 */
const pending = new Set<string>();
let timer: ReturnType<typeof setTimeout> | null = null;

function scheduleReload(dirPath: string, reload: (path: string) => void): void {
  pending.add(dirPath);
  if (timer !== null) return;

  timer = setTimeout(() => {
    timer = null;
    const paths = [...pending];
    pending.clear();
    for (const path of paths) reload(path);
  }, 120);
}

export const useExplorer = create<ExplorerState>((set, get) => ({
  roots: [],
  directories: {},
  expanded: [],
  filter: '',
  markdownOnly: false,
  showHidden: false,
  error: null,

  init: async () => {
    try {
      const roots = await fsProvider.roots();
      set({ roots });
      const first = roots[0];
      if (first !== undefined) await get().expand(first);
    } catch (error) {
      set({ error: describe(error) });
    }
  },

  addRoot: async (dirPath) => {
    const trimmed = dirPath.trim();
    if (trimmed.length === 0) return;
    try {
      const roots = await fsProvider.addRoot(trimmed);
      set({ roots, error: null });
      const added = roots.find((root) => samePath(root, trimmed)) ?? roots[roots.length - 1];
      if (added !== undefined) await get().expand(added);
    } catch (error) {
      set({ error: describe(error) });
    }
  },

  removeRoot: async (dirPath) => {
    try {
      const roots = await fsProvider.removeRoot(dirPath);
      const directories = { ...get().directories };
      for (const key of Object.keys(directories)) {
        if (isInside(dirPath, key)) delete directories[key];
      }
      set({
        roots,
        directories,
        expanded: get().expanded.filter((path) => !isInside(dirPath, path)),
      });
    } catch (error) {
      set({ error: describe(error) });
    }
  },

  loadDir: async (dirPath) => {
    const existing = get().directories[dirPath];
    set({
      directories: {
        ...get().directories,
        [dirPath]: { entries: existing?.entries ?? [], loading: true, error: null },
      },
    });

    try {
      const entries = await fsProvider.listDir(dirPath);
      set({
        directories: { ...get().directories, [dirPath]: { entries, loading: false, error: null } },
      });
    } catch (error) {
      set({
        directories: {
          ...get().directories,
          [dirPath]: { entries: [], loading: false, error: describe(error) },
        },
      });
    }
  },

  expand: async (dirPath) => {
    if (!get().expanded.includes(dirPath)) {
      set({ expanded: [...get().expanded, dirPath] });
    }
    if (!get().directories[dirPath]) {
      await get().loadDir(dirPath);
    }
  },

  toggle: async (dirPath) => {
    if (get().expanded.includes(dirPath)) {
      set({ expanded: get().expanded.filter((path) => path !== dirPath) });
      return;
    }
    await get().expand(dirPath);
  },

  collapseAll: () => set({ expanded: [] }),

  setFilter: (filter) => set({ filter }),
  setMarkdownOnly: (markdownOnly) => set({ markdownOnly }),
  setShowHidden: (showHidden) => set({ showHidden }),

  createFile: async (parent, name) => {
    const target = joinPath(parent, name);
    try {
      await fsProvider.createFile(target);
      await get().expand(parent);
      await get().loadDir(parent);
      return target;
    } catch (error) {
      set({ error: describe(error) });
      return null;
    }
  },

  createFolder: async (parent, name) => {
    try {
      await fsProvider.createDirectory(joinPath(parent, name));
      await get().expand(parent);
      await get().loadDir(parent);
    } catch (error) {
      set({ error: describe(error) });
    }
  },

  renameEntry: async (target, nextName) => {
    const parent = parentDir(target);
    if (parent === null) {
      set({ error: `Cannot rename ${target}` });
      return null;
    }

    const destination = joinPath(parent, nextName);
    try {
      await fsProvider.rename(target, destination);
      await get().loadDir(parent);
      return destination;
    } catch (error) {
      set({ error: describe(error) });
      return null;
    }
  },

  trashEntry: async (target) => {
    try {
      await fsProvider.trash(target);
      const parent = parentDir(target);
      if (parent !== null) await get().loadDir(parent);
    } catch (error) {
      set({ error: describe(error) });
    }
  },

  moveEntry: async (source, destinationDir) => {
    const from = parentDir(source);
    if (from !== null && samePath(from, destinationDir)) return null;

    // Dragging a folder into itself, or into its own child, would delete it.
    if (isInside(source, destinationDir)) {
      set({ error: 'A folder cannot be moved inside itself.' });
      return null;
    }

    const destination = joinPath(destinationDir, basename(source));
    try {
      await fsProvider.rename(source, destination);
      if (from !== null) await get().loadDir(from);
      await get().loadDir(destinationDir);
      return destination;
    } catch (error) {
      set({ error: describe(error) });
      return null;
    }
  },

  applyWatchEvent: (event) => {
    if (event.event === 'error') {
      set({ error: event.message ?? 'The file watcher reported an error.' });
      return;
    }

    if (event.event === 'unlinkDir') {
      const directories = { ...get().directories };
      for (const key of Object.keys(directories)) {
        if (isInside(event.path, key)) delete directories[key];
      }
      set({ directories, expanded: get().expanded.filter((path) => !isInside(event.path, path)) });
    }

    const parent = parentDir(event.path);
    // Only refresh listings already on screen; nothing else is worth the round trip.
    if (parent !== null && get().directories[parent]) {
      scheduleReload(parent, (path) => void get().loadDir(path));
    }
  },

  clearError: () => set({ error: null }),
}));

/**
 * The visible rows, in order.
 *
 * The filter narrows what is already loaded rather than searching the disk, so a match
 * inside a collapsed folder will not appear. Workspace-wide search is P7.
 */
export function flattenTree(input: TreeInput): TreeRow[] {
  const needle = input.filter.trim().toLowerCase();

  const visit = (
    path: string,
    name: string,
    kind: EntryKind,
    depth: number,
    root: string,
    isRoot: boolean,
  ): TreeRow[] => {
    const directory = input.directories[path];
    const expanded = input.expanded.includes(path);

    const children: TreeRow[] = [];
    if (kind === 'directory' && expanded && directory) {
      for (const entry of visibleEntries(directory.entries, input)) {
        children.push(...visit(entry.path, entry.name, entry.kind, depth + 1, root, false));
      }
    }

    const matches = needle.length === 0 || name.toLowerCase().includes(needle);
    if (!matches && children.length === 0) return [];

    return [
      {
        path,
        name,
        kind,
        depth,
        root,
        isRoot,
        expanded,
        loading: directory?.loading ?? false,
      },
      ...children,
    ];
  };

  return input.roots.flatMap((root) => visit(root, basename(root), 'directory', 0, root, true));
}

function visibleEntries(entries: readonly DirEntry[], input: TreeInput): DirEntry[] {
  return entries.filter((entry) => {
    if (!input.showHidden && entry.name.startsWith('.')) return false;
    if (input.markdownOnly && entry.kind === 'file' && !isMarkdownPath(entry.path)) return false;
    return true;
  });
}
