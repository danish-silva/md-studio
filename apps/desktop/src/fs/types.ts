/**
 * The seam between the UI and the host filesystem.
 *
 * Two implementations exist: `dev-http` (a Vite middleware, used in development and by
 * Playwright) and `tauri` (Rust over IPC, arriving in P9). Nothing above this layer knows
 * which one it is talking to.
 */

export type EntryKind = 'file' | 'directory';

export interface DirEntry {
  name: string;
  path: string;
  kind: EntryKind;
  size: number;
  mtimeMs: number;
}

export interface FileStat {
  path: string;
  size: number;
  mtimeMs: number;
}

export interface FileContents {
  path: string;
  text: string;
  stat: FileStat;
}

export interface WriteOptions {
  /** Refuse the write unless the file on disk still has this mtime. */
  expectedMtimeMs?: number;
}

export interface AssetWrite {
  /** Directory to write into; created if it does not exist. */
  dir: string;
  /** Preferred file name. The provider makes it unique and filesystem-safe. */
  name: string;
  data: ArrayBuffer;
}

export type WatchEventKind = 'add' | 'addDir' | 'change' | 'unlink' | 'unlinkDir' | 'error';

export interface WatchEvent {
  event: WatchEventKind;
  path: string;
  message?: string;
}

export interface FileSystemProvider {
  readonly id: string;
  /** Directories this provider is permitted to reach. */
  roots(): Promise<string[]>;
  /** Grants access to another folder; the dev stand-in for Tauri's scoped fs permission. */
  addRoot(dirPath: string): Promise<string[]>;
  removeRoot(dirPath: string): Promise<string[]>;

  listDir(dirPath: string): Promise<DirEntry[]>;
  readFile(filePath: string): Promise<FileContents>;
  stat(targetPath: string): Promise<FileStat>;
  writeFile(filePath: string, text: string, options?: WriteOptions): Promise<FileStat>;
  /** Writes binary data, returning the path actually used. */
  writeAsset(asset: AssetWrite): Promise<FileStat>;

  createFile(filePath: string, text?: string): Promise<FileStat>;
  createDirectory(dirPath: string): Promise<FileStat>;
  rename(from: string, to: string): Promise<FileStat>;
  /** Moves to the system recycle bin. Never an unrecoverable delete. */
  trash(targetPath: string): Promise<void>;

  /** Subscribes to filesystem events under the roots; returns an unsubscribe function. */
  watch(listener: (event: WatchEvent) => void): () => void;
}

/** Thrown when a write is refused because the file changed underneath us. */
export class StaleWriteError extends Error {
  constructor(readonly current: FileStat) {
    super('File changed on disk since it was opened');
    this.name = 'StaleWriteError';
  }
}
