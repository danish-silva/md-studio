import { create } from 'zustand';
import { fsProvider } from '../fs';
import { takeClosedByUser, useDocuments, type ClosedTab, type TabSnapshot } from './documents';
import { useExplorer } from './explorer';
import { useLayout } from './layout';

const INDEX_FILE = 'index.json';
const DRAFT_PREFIX = 'draft-';
const PERSIST_DELAY_MS = 500;

export interface WorkspaceSnapshot {
  version: 1;
  id: string;
  name: string;
  roots: string[];
  expanded: string[];
  tabs: TabSnapshot[];
  activePath: string | null;
  recentlyClosed: ClosedTab[];
  settings: {
    autoArchiveDays: number;
    markdownOnly: boolean;
    showHidden: boolean;
  };
  layout: {
    sidebarWidth: number;
    sidebarCollapsed: boolean;
  };
}

export interface WorkspaceEntry {
  id: string;
  name: string;
  lastOpenedAt: number;
}

export interface WorkspaceIndex {
  version: 1;
  activeId: string | null;
  workspaces: WorkspaceEntry[];
}

export interface PendingDraft {
  path: string;
  text: string;
  savedAt: number;
}

export interface WorkspaceState {
  id: string | null;
  name: string;
  list: WorkspaceEntry[];
  /** True while a workspace is being applied; autosave stays out of the way. */
  restoring: boolean;
  /** Unsaved buffers found on launch, waiting for the user to decide. */
  pendingDrafts: PendingDraft[];
  /** Tabs whose files no longer exist, dropped during restore. */
  droppedTabs: string[];
  /**
   * Set when the workspace file exists but could not be read. Saving is suspended while
   * it is true, because writing over a file we failed to parse would destroy the session
   * it describes.
   */
  corrupt: boolean;
  error: string | null;

  boot: () => Promise<void>;
  switchTo: (id: string) => Promise<void>;
  createWorkspace: (name: string) => Promise<void>;
  renameWorkspace: (id: string, name: string) => Promise<void>;
  deleteWorkspace: (id: string) => Promise<void>;

  startAutosave: () => () => void;
  persistNow: () => Promise<void>;

  resolveDrafts: (action: 'keep' | 'discard') => Promise<void>;
  dismissDropped: () => void;
  clearError: () => void;
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function fileFor(id: string): string {
  return `workspace-${id}.json`;
}

/** A stable, filesystem-safe name for a path's draft. FNV-1a is plenty here. */
export function draftName(path: string): string {
  const normalised = path.replace(/[\\/]+/g, '/').toLowerCase();
  let hash = 0x811c9dc5;
  for (let index = 0; index < normalised.length; index += 1) {
    hash ^= normalised.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return `${DRAFT_PREFIX}${hash.toString(16).padStart(8, '0')}.json`;
}

/** Everything worth remembering about the current session. */
export function snapshotOf(id: string, name: string): WorkspaceSnapshot {
  const documents = useDocuments.getState();
  const explorer = useExplorer.getState();
  const layout = useLayout.getState();

  return {
    version: 1,
    id,
    name,
    roots: explorer.roots,
    expanded: explorer.expanded,
    tabs: documents.order.flatMap((path) => {
      const doc = documents.byPath[path];
      if (!doc) return [];
      return [
        {
          path: doc.path,
          pinned: doc.pinned,
          mode: doc.mode,
          cursor: doc.cursor,
          scrollTop: doc.scrollTop,
          lastActiveAt: doc.lastActiveAt,
        },
      ];
    }),
    activePath: documents.activePath,
    recentlyClosed: documents.recentlyClosed,
    settings: {
      autoArchiveDays: documents.autoArchiveDays,
      markdownOnly: explorer.markdownOnly,
      showHidden: explorer.showHidden,
    },
    layout: {
      sidebarWidth: layout.sidebarWidth,
      sidebarCollapsed: layout.sidebarCollapsed,
    },
  };
}

/** Tolerant on the way in: a workspace file is not worth losing a session over. */
export function parseSnapshot(raw: string): WorkspaceSnapshot | null {
  try {
    const value: unknown = JSON.parse(raw);
    if (typeof value !== 'object' || value === null) return null;

    const record = value as Partial<WorkspaceSnapshot>;
    if (typeof record.id !== 'string') return null;

    return {
      version: 1,
      id: record.id,
      name: typeof record.name === 'string' ? record.name : 'Workspace',
      roots: stringsOf(record.roots),
      expanded: stringsOf(record.expanded),
      tabs: Array.isArray(record.tabs) ? record.tabs.filter(isTabSnapshot) : [],
      activePath: typeof record.activePath === 'string' ? record.activePath : null,
      recentlyClosed: Array.isArray(record.recentlyClosed)
        ? record.recentlyClosed.filter(isClosedTab)
        : [],
      settings: {
        autoArchiveDays: numberOr(record.settings?.autoArchiveDays, 7),
        markdownOnly: record.settings?.markdownOnly === true,
        showHidden: record.settings?.showHidden === true,
      },
      layout: {
        sidebarWidth: numberOr(record.layout?.sidebarWidth, 260),
        sidebarCollapsed: record.layout?.sidebarCollapsed === true,
      },
    };
  } catch {
    return null;
  }
}

function stringsOf(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === 'string') : [];
}

function numberOr(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function isTabSnapshot(value: unknown): value is TabSnapshot {
  if (typeof value !== 'object' || value === null) return false;
  const tab = value as Partial<TabSnapshot>;
  return typeof tab.path === 'string' && (tab.mode === 'wysiwyg' || tab.mode === 'source');
}

function isClosedTab(value: unknown): value is ClosedTab {
  if (typeof value !== 'object' || value === null) return false;
  const tab = value as Partial<ClosedTab>;
  return typeof tab.path === 'string' && typeof tab.closedAt === 'number';
}

async function readIndex(): Promise<WorkspaceIndex> {
  const raw = await fsProvider.readConfig(INDEX_FILE).catch(() => null);
  if (raw === null) return { version: 1, activeId: null, workspaces: [] };

  try {
    const value: unknown = JSON.parse(raw);
    const record = value as Partial<WorkspaceIndex>;
    const workspaces = Array.isArray(record.workspaces)
      ? record.workspaces.filter(
          (entry): entry is WorkspaceEntry =>
            typeof entry === 'object' &&
            entry !== null &&
            typeof (entry as WorkspaceEntry).id === 'string',
        )
      : [];
    return {
      version: 1,
      activeId: typeof record.activeId === 'string' ? record.activeId : null,
      workspaces,
    };
  } catch {
    return { version: 1, activeId: null, workspaces: [] };
  }
}

async function writeIndex(index: WorkspaceIndex): Promise<void> {
  await fsProvider.writeConfig(INDEX_FILE, JSON.stringify(index, null, 2));
}

/** Last text written for each draft, so unchanged buffers are not rewritten. */
const draftsOnDisk = new Map<string, string>();

let persistTimer: ReturnType<typeof setTimeout> | null = null;

export const useWorkspace = create<WorkspaceState>((set, get) => ({
  id: null,
  name: 'Workspace',
  list: [],
  restoring: true,
  pendingDrafts: [],
  droppedTabs: [],
  corrupt: false,
  error: null,

  boot: async () => {
    set({ restoring: true, error: null });
    try {
      const index = await readIndex();
      const entry =
        index.workspaces.find((candidate) => candidate.id === index.activeId) ??
        index.workspaces[0];

      if (!entry) {
        // First run: adopt whatever folders the provider already allows.
        await useExplorer.getState().init();
        const created: WorkspaceEntry = {
          id: newId(),
          name: 'Workspace',
          lastOpenedAt: Date.now(),
        };
        set({ id: created.id, name: created.name, list: [created], restoring: false });
        await writeIndex({ version: 1, activeId: created.id, workspaces: [created] });
        await get().persistNow();
        return;
      }

      set({ list: index.workspaces });
      await applyWorkspace(entry.id, set, get);
    } catch (error) {
      set({ restoring: false, error: describe(error) });
    }
  },

  switchTo: async (id) => {
    if (get().id === id) return;
    await get().persistNow();
    await applyWorkspace(id, set, get);

    const index = await readIndex();
    await writeIndex({ ...index, activeId: id });
  },

  createWorkspace: async (name) => {
    await get().persistNow();

    const entry: WorkspaceEntry = { id: newId(), name, lastOpenedAt: Date.now() };
    const index = await readIndex();
    await writeIndex({
      version: 1,
      activeId: entry.id,
      workspaces: [...index.workspaces, entry],
    });

    // A new workspace starts empty: no folders, no tabs.
    set({ restoring: true });
    useDocuments.setState({ order: [], byPath: {}, activePath: null, recentlyClosed: [] });
    for (const root of useExplorer.getState().roots) {
      await fsProvider.removeRoot(root).catch(() => null);
    }
    useExplorer.setState({ roots: [], directories: {}, expanded: [], filter: '' });

    set({
      id: entry.id,
      name: entry.name,
      list: [...get().list, entry],
      pendingDrafts: [],
      droppedTabs: [],
      corrupt: false,
      restoring: false,
    });
    await get().persistNow();
  },

  renameWorkspace: async (id, name) => {
    const index = await readIndex();
    const workspaces = index.workspaces.map((entry) =>
      entry.id === id ? { ...entry, name } : entry,
    );
    await writeIndex({ ...index, workspaces });
    set({ list: workspaces, name: get().id === id ? name : get().name });
    await get().persistNow();
  },

  deleteWorkspace: async (id) => {
    const index = await readIndex();
    const workspaces = index.workspaces.filter((entry) => entry.id !== id);
    const nextActive = index.activeId === id ? (workspaces[0]?.id ?? null) : index.activeId;

    await writeIndex({ version: 1, activeId: nextActive, workspaces });
    await fsProvider.deleteConfig(fileFor(id)).catch(() => null);
    set({ list: workspaces });

    if (get().id === id && nextActive !== null) {
      await applyWorkspace(nextActive, set, get);
    }
  },

  startAutosave: () => {
    const schedule = () => {
      if (get().restoring || get().id === null) return;
      if (persistTimer !== null) clearTimeout(persistTimer);
      persistTimer = setTimeout(() => {
        persistTimer = null;
        void get().persistNow();
      }, PERSIST_DELAY_MS);
    };

    const unsubscribe = [
      useDocuments.subscribe(schedule),
      useExplorer.subscribe(schedule),
      useLayout.subscribe(schedule),
    ];

    // A closing window gets one best-effort flush.
    const onHide = () => void get().persistNow();
    window.addEventListener('pagehide', onHide);

    return () => {
      for (const stop of unsubscribe) stop();
      window.removeEventListener('pagehide', onHide);
    };
  },

  persistNow: async () => {
    const { id, name, corrupt } = get();
    if (id === null || corrupt) return;

    try {
      const snapshot = snapshotOf(id, name);
      await fsProvider.writeConfig(fileFor(id), JSON.stringify(snapshot, null, 2));
      await syncDrafts();
    } catch (error) {
      set({ error: describe(error) });
    }
  },

  resolveDrafts: async (action) => {
    const drafts = get().pendingDrafts;
    set({ pendingDrafts: [] });

    for (const draft of drafts) {
      if (action === 'discard') {
        await fsProvider.deleteConfig(draftName(draft.path)).catch(() => null);
        draftsOnDisk.delete(draft.path);
        continue;
      }

      const documents = useDocuments.getState();
      if (!documents.byPath[draft.path]) await documents.open(draft.path);
      useDocuments.getState().replaceText(draft.path, draft.text);
      draftsOnDisk.set(draft.path, draft.text);
    }
  },

  dismissDropped: () => set({ droppedTabs: [] }),
  clearError: () => set({ error: null }),
}));

type Setter = (partial: Partial<WorkspaceState>) => void;
type Getter = () => WorkspaceState;

async function applyWorkspace(id: string, set: Setter, get: Getter): Promise<void> {
  set({ restoring: true, pendingDrafts: [], droppedTabs: [], corrupt: false, error: null });

  try {
    const raw = await fsProvider.readConfig(fileFor(id));
    const snapshot = raw === null ? null : parseSnapshot(raw);

    if (snapshot === null) {
      // A missing file is a new workspace; an unreadable one is a problem worth saying
      // out loud, and worth not overwriting.
      const unreadable = raw !== null;
      await useExplorer.getState().init();
      set({
        id,
        restoring: false,
        corrupt: unreadable,
        error: unreadable
          ? `This workspace could not be read, so ${fileFor(id)} has been left untouched and nothing will be saved over it.`
          : null,
      });
      return;
    }

    // Folders first: a root has to be reachable before anything inside it is read.
    for (const root of snapshot.roots) {
      await fsProvider.addRoot(root).catch(() => null);
    }
    const roots = await fsProvider.roots();

    useExplorer.setState({
      roots,
      directories: {},
      expanded: snapshot.expanded,
      filter: '',
      markdownOnly: snapshot.settings.markdownOnly,
      showHidden: snapshot.settings.showHidden,
      error: null,
    });
    for (const directory of [...roots, ...snapshot.expanded]) {
      await useExplorer.getState().loadDir(directory);
    }

    useLayout.setState({
      sidebarWidth: snapshot.layout.sidebarWidth,
      sidebarCollapsed: snapshot.layout.sidebarCollapsed,
    });

    useDocuments.setState({
      order: [],
      byPath: {},
      activePath: null,
      recentlyClosed: snapshot.recentlyClosed,
      autoArchiveDays: snapshot.settings.autoArchiveDays,
      pendingClose: null,
      error: null,
    });

    const dropped: string[] = [];
    for (const tab of snapshot.tabs) {
      await useDocuments.getState().open(tab.path);
      if (useDocuments.getState().byPath[tab.path]) {
        useDocuments.getState().applySnapshot(tab);
      } else {
        dropped.push(tab.path);
      }
    }

    if (snapshot.activePath !== null && useDocuments.getState().byPath[snapshot.activePath]) {
      useDocuments.getState().activate(snapshot.activePath);
    }

    const entry = get().list.find((candidate) => candidate.id === id);
    set({
      id,
      name: snapshot.name || entry?.name || 'Workspace',
      corrupt: false,
      droppedTabs: dropped,
      pendingDrafts: await collectDrafts(),
      restoring: false,
    });
  } catch (error) {
    set({ restoring: false, error: describe(error) });
  }
}

/**
 * Unsaved buffers left behind by the last session.
 *
 * Drafts are read for every file that has one, not only for restored tabs: a crash can
 * happen before the workspace file is written, and that is exactly when recovery matters.
 */
async function collectDrafts(): Promise<PendingDraft[]> {
  const names = await fsProvider.listConfigs(DRAFT_PREFIX).catch(() => [] as string[]);
  const drafts: PendingDraft[] = [];

  for (const name of names) {
    const raw = await fsProvider.readConfig(name).catch(() => null);
    if (raw === null) continue;

    let draft: PendingDraft | null = null;
    try {
      const value = JSON.parse(raw) as Partial<PendingDraft>;
      if (typeof value.path === 'string' && typeof value.text === 'string') {
        draft = { path: value.path, text: value.text, savedAt: numberOr(value.savedAt, 0) };
      }
    } catch {
      draft = null;
    }
    if (draft === null) continue;

    // A draft matching what is on disk was already saved; nothing to recover.
    const onDisk = await fsProvider
      .readFile(draft.path)
      .then((contents) => contents.text)
      .catch(() => null);

    if (onDisk === null || onDisk === draft.text) {
      await fsProvider.deleteConfig(name).catch(() => null);
      continue;
    }
    drafts.push(draft);
  }

  return drafts;
}

async function syncDrafts(): Promise<void> {
  const documents = useDocuments.getState();

  for (const path of documents.order) {
    const doc = documents.byPath[path];
    if (!doc) continue;

    if (doc.dirty) {
      if (draftsOnDisk.get(path) === doc.text) continue;
      await fsProvider.writeConfig(
        draftName(path),
        JSON.stringify({ version: 1, path, text: doc.text, savedAt: Date.now() }),
      );
      draftsOnDisk.set(path, doc.text);
    } else if (draftsOnDisk.has(path)) {
      await fsProvider.deleteConfig(draftName(path)).catch(() => null);
      draftsOnDisk.delete(path);
    }
  }

  // A document the user closed has had its decision made, so its draft goes too. A
  // document that merely left the set — a workspace switch — keeps its draft, and the
  // recovery bar offers it again on the way back.
  for (const path of takeClosedByUser()) {
    await fsProvider.deleteConfig(draftName(path)).catch(() => null);
    draftsOnDisk.delete(path);
  }
}

function newId(): string {
  return globalThis.crypto.randomUUID().slice(0, 8);
}
