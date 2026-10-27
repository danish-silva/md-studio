import { create } from 'zustand';
import { fsProvider } from '../fs';
import { joinPath } from '../lib/text';

export type FileStatus = 'modified' | 'added' | 'deleted' | 'renamed' | 'untracked' | 'conflicted';

export interface GitEntry {
  /** Absolute path, so the explorer can match it against its own rows. */
  path: string;
  staged: boolean;
  status: FileStatus;
}

export interface GitState {
  /** The repository's top level, or null when the folder is not a repository. */
  root: string | null;
  branch: string | null;
  entries: GitEntry[];
  /** Status by absolute path, for the badges in the tree. */
  byPath: Record<string, FileStatus>;
  busy: boolean;
  error: string | null;

  detect: (folder: string) => Promise<void>;
  refresh: () => Promise<void>;
  scheduleRefresh: () => void;
  stage: (path: string) => Promise<void>;
  unstage: (path: string) => Promise<void>;
  stageAll: () => Promise<void>;
  commit: (message: string) => Promise<boolean>;
  clearError: () => void;
}

let refreshTimer: ReturnType<typeof setTimeout> | null = null;

function statusFromCode(code: string): FileStatus {
  switch (code) {
    case 'A':
      return 'added';
    case 'D':
      return 'deleted';
    case 'R':
      return 'renamed';
    case 'U':
      return 'conflicted';
    default:
      return 'modified';
  }
}

/**
 * Parses `git status --porcelain=v1`.
 *
 * The two status columns are the index and the working tree, so one file can appear in
 * both lists — staged a change, then edited it again. That is worth showing rather than
 * flattening.
 */
export function parseStatus(stdout: string, root: string): GitEntry[] {
  const entries: GitEntry[] = [];

  for (const line of stdout.split('\n')) {
    if (line.length < 4) continue;

    const index = line[0] ?? ' ';
    const worktree = line[1] ?? ' ';
    let name = line.slice(3).trim();

    // A rename reads "old -> new"; the new name is the one that exists.
    const arrow = name.indexOf(' -> ');
    if (arrow >= 0) name = name.slice(arrow + 4);

    const path = joinPath(root, name.replace(/\//g, root.includes('\\') ? '\\' : '/'));

    if (index === '?' || worktree === '?') {
      entries.push({ path, staged: false, status: 'untracked' });
      continue;
    }
    if (index !== ' ') entries.push({ path, staged: true, status: statusFromCode(index) });
    if (worktree !== ' ') entries.push({ path, staged: false, status: statusFromCode(worktree) });
  }

  return entries;
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export const useGit = create<GitState>((set, get) => ({
  root: null,
  branch: null,
  entries: [],
  byPath: {},
  busy: false,
  error: null,

  detect: async (folder) => {
    try {
      const result = await fsProvider.runGit(folder, ['rev-parse', '--show-toplevel']);
      if (result.code !== 0) {
        set({ root: null, branch: null, entries: [], byPath: {} });
        return;
      }
      set({ root: result.stdout.trim().replace(/\//g, folder.includes('\\') ? '\\' : '/') });
      await get().refresh();
    } catch (error) {
      set({ root: null, branch: null, error: describe(error) });
    }
  },

  refresh: async () => {
    const root = get().root;
    if (root === null) return;

    set({ busy: true });
    try {
      const [branch, status] = await Promise.all([
        fsProvider.runGit(root, ['rev-parse', '--abbrev-ref', 'HEAD']),
        // quotepath off keeps non-ASCII names readable rather than escaped.
        fsProvider.runGit(root, ['-c', 'core.quotepath=false', 'status', '--porcelain=v1']),
      ]);

      const entries = parseStatus(status.stdout, root);
      const byPath: Record<string, FileStatus> = {};
      for (const entry of entries) {
        // A staged entry and an unstaged one for the same file: show the working tree.
        if (!entry.staged || byPath[entry.path] === undefined) byPath[entry.path] = entry.status;
      }

      set({
        branch: branch.code === 0 ? branch.stdout.trim() : null,
        entries,
        byPath,
        busy: false,
        error: null,
      });
    } catch (error) {
      set({ busy: false, error: describe(error) });
    }
  },

  /** Watch events arrive in bursts; one status call per burst is plenty. */
  scheduleRefresh: () => {
    if (get().root === null) return;
    if (refreshTimer !== null) clearTimeout(refreshTimer);
    refreshTimer = setTimeout(() => {
      refreshTimer = null;
      void get().refresh();
    }, 500);
  },

  stage: async (path) => {
    await run(get, set, ['add', '--', path]);
  },

  unstage: async (path) => {
    await run(get, set, ['restore', '--staged', '--', path]);
  },

  stageAll: async () => {
    await run(get, set, ['add', '--all']);
  },

  commit: async (message) => {
    const root = get().root;
    if (root === null || message.trim().length === 0) return false;

    set({ busy: true, error: null });
    try {
      const result = await fsProvider.runGit(root, ['commit', '-m', message]);
      set({ busy: false });

      if (result.code !== 0) {
        set({ error: (result.stderr || result.stdout).trim() || 'git commit failed' });
        return false;
      }
      await get().refresh();
      return true;
    } catch (error) {
      set({ busy: false, error: describe(error) });
      return false;
    }
  },

  clearError: () => set({ error: null }),
}));

type Setter = (partial: Partial<GitState>) => void;

async function run(get: () => GitState, set: Setter, args: string[]): Promise<void> {
  const root = get().root;
  if (root === null) return;

  set({ busy: true, error: null });
  try {
    const result = await fsProvider.runGit(root, args);
    set({ busy: false });
    if (result.code !== 0) {
      set({ error: (result.stderr || result.stdout).trim() || `git ${args[0] ?? ''} failed` });
      return;
    }
    await get().refresh();
  } catch (error) {
    set({ busy: false, error: describe(error) });
  }
}
