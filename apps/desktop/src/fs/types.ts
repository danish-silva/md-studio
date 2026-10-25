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

export interface FileSystemProvider {
  readonly id: string;
  /** Directories this provider is permitted to reach. */
  roots(): Promise<string[]>;
  listDir(dirPath: string): Promise<DirEntry[]>;
  readFile(filePath: string): Promise<FileContents>;
  stat(targetPath: string): Promise<FileStat>;
  writeFile(filePath: string, text: string, options?: WriteOptions): Promise<FileStat>;
}

/** Thrown when a write is refused because the file changed underneath us. */
export class StaleWriteError extends Error {
  constructor(readonly current: FileStat) {
    super('File changed on disk since it was opened');
    this.name = 'StaleWriteError';
  }
}
