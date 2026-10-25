import {
  StaleWriteError,
  type DirEntry,
  type FileContents,
  type FileStat,
  type FileSystemProvider,
  type WriteOptions,
} from './types';

const BASE = '/__fs';

interface ErrorPayload {
  error?: string;
  code?: string;
  stat?: FileStat;
}

async function request<T>(route: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${BASE}${route}`, init);
  const payload: unknown = await response.json().catch(() => null);

  if (!response.ok) {
    throw toError(response.status, payload);
  }
  return payload as T;
}

function toError(status: number, payload: unknown): Error {
  const body: ErrorPayload = typeof payload === 'object' && payload !== null ? payload : {};
  if (status === 409 && body.code === 'stale' && body.stat) {
    return new StaleWriteError(body.stat);
  }
  return new Error(body.error ?? `Filesystem request failed (${status})`);
}

function query(targetPath: string): string {
  return `?path=${encodeURIComponent(targetPath)}`;
}

export const devHttpProvider: FileSystemProvider = {
  id: 'dev-http',

  async roots() {
    const { roots } = await request<{ roots: string[] }>('/roots');
    return roots;
  },

  async listDir(dirPath) {
    const { entries } = await request<{ entries: DirEntry[] }>(`/list${query(dirPath)}`);
    return entries;
  },

  readFile(filePath) {
    return request<FileContents>(`/read${query(filePath)}`);
  },

  async stat(targetPath) {
    const { stat } = await request<{ stat: FileStat }>(`/stat${query(targetPath)}`);
    return stat;
  },

  async writeFile(filePath, text, options?: WriteOptions) {
    const body: Record<string, unknown> = { path: filePath, text };
    if (options?.expectedMtimeMs !== undefined) {
      body['expectedMtimeMs'] = options.expectedMtimeMs;
    }

    const { stat } = await request<{ stat: FileStat }>('/write', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    return stat;
  },
};
