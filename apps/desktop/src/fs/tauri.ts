import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import {
  StaleWriteError,
  type ContentSearchResult,
  type DirEntry,
  type FileContents,
  type FileStat,
  type FileSystemProvider,
  type GitResult,
  type WatchEvent,
  type WriteOptions,
} from './types';

/**
 * The shipping filesystem: Rust over Tauri IPC.
 *
 * Every command mirrors one in the development middleware, so nothing above this layer
 * can tell which is underneath. The one addition is `pickFolder`, which a browser cannot
 * offer — the UI falls back to asking for a typed path when it is absent.
 */
async function call<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  try {
    return await invoke<T>(command, args);
  } catch (error) {
    throw toError(error);
  }
}

/** Rust returns a structured error; a refused write has to stay distinguishable. */
function toError(error: unknown): Error {
  if (typeof error === 'object' && error !== null) {
    const body = error as { message?: string; code?: string; stat?: FileStat };
    if (body.code === 'stale' && body.stat) return new StaleWriteError(body.stat);
    if (typeof body.message === 'string') return new Error(body.message);
  }
  return new Error(String(error));
}

export const tauriProvider: FileSystemProvider = {
  id: 'tauri',

  roots: () => call<string[]>('fs_roots'),
  addRoot: (dirPath) => call<string[]>('fs_add_root', { path: dirPath }),
  removeRoot: (dirPath) => call<string[]>('fs_remove_root', { path: dirPath }),

  listDir: (dirPath) => call<DirEntry[]>('fs_list_dir', { path: dirPath }),
  readFile: (filePath) => call<FileContents>('fs_read_file', { path: filePath }),
  stat: (targetPath) => call<FileStat>('fs_stat', { path: targetPath }),

  writeFile: (filePath, text, options?: WriteOptions) =>
    call<FileStat>('fs_write_file', {
      path: filePath,
      text,
      expectedMtimeMs: options?.expectedMtimeMs ?? null,
    }),

  writeAsset: ({ dir, name, data }) =>
    call<FileStat>('fs_write_asset', {
      dir,
      name,
      // Tauri takes a byte array for Vec<u8>.
      data: Array.from(new Uint8Array(data)),
    }),

  createFile: (filePath, text = '') =>
    call<FileStat>('fs_create', { path: filePath, kind: 'file', text }),
  createDirectory: (dirPath) =>
    call<FileStat>('fs_create', { path: dirPath, kind: 'directory', text: null }),
  rename: (from, to) => call<FileStat>('fs_rename', { from, to }),
  trash: (targetPath) => call<void>('fs_trash', { path: targetPath }),

  findFiles: (limit = 2000) => call<string[]>('fs_find_files', { limit }),
  searchContent: ({ query, regex, caseSensitive, limit = 500 }) =>
    call<ContentSearchResult>('fs_search_content', {
      options: { query, regex, caseSensitive, limit },
    }),

  readConfig: (name) => call<string | null>('config_read', { name }),
  writeConfig: (name, text) => call<void>('config_write', { name, text }),
  deleteConfig: (name) => call<void>('config_delete', { name }),
  listConfigs: (prefix) => call<string[]>('config_list', { prefix }),

  pickFolder: () => call<string | null>('pick_folder'),

  saveDialog: (options) => call<string | null>('save_dialog', { options }),
  writeBinary: (path, data) =>
    call<FileStat>('fs_write_binary', { path, data: Array.from(data) }),

  runGit: (cwd, args) => call<GitResult>('git_run', { cwd, args }),

  watch(listener) {
    // `listen` resolves asynchronously, so unsubscribing has to cope with being called
    // before the subscription exists.
    let stop: (() => void) | null = null;
    let cancelled = false;

    void listen<WatchEvent>('fs-event', (event) => listener(event.payload))
      .then((unlisten) => {
        if (cancelled) unlisten();
        else stop = unlisten;
      })
      .catch(() => {
        // Without a watcher the app still works; it just will not notice outside edits.
      });

    return () => {
      cancelled = true;
      stop?.();
    };
  },
};
