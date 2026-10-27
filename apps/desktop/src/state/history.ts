import { create } from 'zustand';
import { fsProvider } from '../fs';

const INDEX_PREFIX = 'hist-';
const BLOB_PREFIX = 'snap-';

/** Versions kept per file. Markdown is small; this is generous and still bounded. */
const LIMIT = 50;

export interface Snapshot {
  hash: string;
  savedAt: number;
  size: number;
}

interface HistoryIndex {
  version: 1;
  path: string;
  entries: Snapshot[];
}

async function sha256(text: string): Promise<string> {
  const bytes = new TextEncoder().encode(text);
  const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

function indexName(pathHash: string): string {
  return `${INDEX_PREFIX}${pathHash}.json`;
}

function blobName(contentHash: string): string {
  return `${BLOB_PREFIX}${contentHash}.md`;
}

async function readIndex(path: string): Promise<HistoryIndex> {
  const name = indexName((await sha256(path.toLowerCase().replace(/\\/g, '/'))).slice(0, 16));
  const raw = await fsProvider.readConfig(name).catch(() => null);
  if (raw === null) return { version: 1, path, entries: [] };

  try {
    const value = JSON.parse(raw) as Partial<HistoryIndex>;
    const entries = Array.isArray(value.entries) ? value.entries.filter(isSnapshot) : [];
    return { version: 1, path, entries };
  } catch {
    return { version: 1, path, entries: [] };
  }
}

function isSnapshot(value: unknown): value is Snapshot {
  if (typeof value !== 'object' || value === null) return false;
  const snapshot = value as Partial<Snapshot>;
  return typeof snapshot.hash === 'string' && typeof snapshot.savedAt === 'number';
}

async function writeIndex(index: HistoryIndex): Promise<void> {
  const name = indexName((await sha256(index.path.toLowerCase().replace(/\\/g, '/'))).slice(0, 16));
  await fsProvider.writeConfig(name, JSON.stringify(index));
}

/**
 * Records a version of a file, content-addressed so saving the same text twice costs
 * nothing. Independent of git, so it works in folders that are not repositories.
 */
export async function recordSnapshot(path: string, text: string): Promise<void> {
  const hash = (await sha256(text)).slice(0, 32);
  const index = await readIndex(path);

  // Saving without changing anything is not a new version.
  if (index.entries[0]?.hash === hash) return;

  await fsProvider.writeConfig(blobName(hash), text);

  const entries = [
    { hash, savedAt: Date.now(), size: text.length },
    ...index.entries.filter((entry) => entry.hash !== hash),
  ];
  const kept = entries.slice(0, LIMIT);

  await writeIndex({ version: 1, path, entries: kept });
  if (entries.length > kept.length) {
    await pruneBlobs();
  }
}

/**
 * Deletes snapshot blobs no index still refers to.
 *
 * Blobs are shared between files by content, so a blob can only go once every history has
 * forgotten it — which is why this scans all of them rather than trusting one.
 */
async function pruneBlobs(): Promise<void> {
  const names = await fsProvider.listConfigs(INDEX_PREFIX).catch(() => [] as string[]);
  const referenced = new Set<string>();

  for (const name of names) {
    const raw = await fsProvider.readConfig(name).catch(() => null);
    if (raw === null) continue;
    try {
      const value = JSON.parse(raw) as Partial<HistoryIndex>;
      for (const entry of value.entries ?? []) {
        if (isSnapshot(entry)) referenced.add(entry.hash);
      }
    } catch {
      // An unreadable index is not permission to delete what it might point at.
      return;
    }
  }

  const blobs = await fsProvider.listConfigs(BLOB_PREFIX).catch(() => [] as string[]);
  for (const blob of blobs) {
    const hash = blob.slice(BLOB_PREFIX.length).replace(/\.md$/, '');
    if (!referenced.has(hash)) await fsProvider.deleteConfig(blob).catch(() => null);
  }
}

export async function readSnapshot(hash: string): Promise<string | null> {
  return fsProvider.readConfig(blobName(hash)).catch(() => null);
}

export interface HistoryState {
  path: string | null;
  entries: Snapshot[];
  loading: boolean;
  preview: { hash: string; text: string } | null;
  error: string | null;

  load: (path: string) => Promise<void>;
  showPreview: (hash: string) => Promise<void>;
  closePreview: () => void;
}

export const useHistory = create<HistoryState>((set) => ({
  path: null,
  entries: [],
  loading: false,
  preview: null,
  error: null,

  load: async (path) => {
    set({ path, loading: true, preview: null, error: null });
    try {
      const index = await readIndex(path);
      set({ entries: index.entries, loading: false });
    } catch (error) {
      set({
        entries: [],
        loading: false,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  },

  showPreview: async (hash) => {
    const text = await readSnapshot(hash);
    set({ preview: text === null ? null : { hash, text } });
  },

  closePreview: () => set({ preview: null }),
}));
