import {
  StaleWriteError,
  type DirEntry,
  type FileContents,
  type FileStat,
  type ContentSearchResult,
  type FileSystemProvider,
  type WatchEvent,
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

  async writeAsset({ dir, name, data }) {
    const query = `?dir=${encodeURIComponent(dir)}&name=${encodeURIComponent(name)}`;
    const { stat } = await request<{ stat: FileStat }>(`/write-asset${query}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/octet-stream' },
      body: data,
    });
    return stat;
  },

  async addRoot(dirPath) {
    const { roots } = await post<{ roots: string[] }>('/roots', { path: dirPath });
    return roots;
  },

  async removeRoot(dirPath) {
    const { roots } = await post<{ roots: string[] }>('/roots/remove', { path: dirPath });
    return roots;
  },

  async createFile(filePath, text = '') {
    const { stat } = await post<{ stat: FileStat }>('/create', {
      path: filePath,
      kind: 'file',
      text,
    });
    return stat;
  },

  async createDirectory(dirPath) {
    const { stat } = await post<{ stat: FileStat }>('/create', {
      path: dirPath,
      kind: 'directory',
    });
    return stat;
  },

  async rename(from, to) {
    const { stat } = await post<{ stat: FileStat }>('/rename', { from, to });
    return stat;
  },

  async trash(targetPath) {
    await post<{ path: string }>('/trash', { path: targetPath });
  },

  async findFiles(limit = 2000) {
    const { files } = await request<{ files: string[] }>(
      `/search/files?limit=${String(limit)}`,
    );
    return files;
  },

  searchContent({ query, regex, caseSensitive, limit = 500 }) {
    const params = new URLSearchParams({
      query,
      regex: regex ? '1' : '0',
      caseSensitive: caseSensitive ? '1' : '0',
      limit: String(limit),
    });
    return request<ContentSearchResult>(`/search/content?${params.toString()}`);
  },

  async readConfig(name) {
    const { text } = await request<{ text: string | null }>(
      `/config?name=${encodeURIComponent(name)}`,
    );
    return text;
  },

  async writeConfig(name, text) {
    await request<{ ok: boolean }>(`/config?name=${encodeURIComponent(name)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain; charset=utf-8' },
      body: text,
    });
  },

  async deleteConfig(name) {
    await post<{ ok: boolean }>('/config/delete', { name });
  },

  async listConfigs(prefix) {
    const { names } = await request<{ names: string[] }>(
      `/config/list?prefix=${encodeURIComponent(prefix)}`,
    );
    return names;
  },

  watch(listener) {
    const source = new EventSource(`${BASE}/watch`);

    source.addEventListener('message', (event: MessageEvent<string>) => {
      try {
        listener(JSON.parse(event.data) as WatchEvent);
      } catch {
        // A malformed frame is not worth tearing the stream down for.
      }
    });

    return () => source.close();
  },
};

function post<T>(route: string, body: Record<string, unknown>): Promise<T> {
  return request<T>(route, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}
