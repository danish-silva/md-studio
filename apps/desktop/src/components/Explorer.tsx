import { useVirtualizer } from '@tanstack/react-virtual';
import { useCallback, useMemo, useRef, useState } from 'react';
import { basename, isInside, isMarkdownPath, parentDir, samePath } from '../lib/text';
import { fsProvider } from '../fs';
import { flattenTree, useExplorer, type TreeRow } from '../state/explorer';
import { useDocuments } from '../state/documents';
import { ContextMenu, type MenuItem } from './ContextMenu';
import { NamePrompt } from './NamePrompt';

type Prompt =
  | { kind: 'newFile'; parent: string }
  | { kind: 'newFolder'; parent: string }
  | { kind: 'rename'; target: string }
  | { kind: 'addRoot' }
  | { kind: 'confirmTrash'; target: string }
  | null;

interface MenuState {
  x: number;
  y: number;
  row: TreeRow;
}

const ROW_HEIGHT = 24;

export function Explorer() {
  const roots = useExplorer((state) => state.roots);
  const directories = useExplorer((state) => state.directories);
  const expanded = useExplorer((state) => state.expanded);
  const filter = useExplorer((state) => state.filter);
  const markdownOnly = useExplorer((state) => state.markdownOnly);
  const showHidden = useExplorer((state) => state.showHidden);
  const error = useExplorer((state) => state.error);

  const activePath = useDocuments((state) => state.activePath);
  const dirty = useDocuments(
    (state) => (state.activePath === null ? false : state.byPath[state.activePath]?.dirty) ?? false,
  );

  const [prompt, setPrompt] = useState<Prompt>(null);
  const [menu, setMenu] = useState<MenuState | null>(null);
  const [dropTarget, setDropTarget] = useState<string | null>(null);

  const scroller = useRef<HTMLDivElement | null>(null);

  const rows = useMemo(
    () => flattenTree({ roots, directories, expanded, filter, markdownOnly, showHidden }),
    [roots, directories, expanded, filter, markdownOnly, showHidden],
  );

  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scroller.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 12,
  });

  /** Where a new file or folder goes when the action did not come from a row. */
  const currentFolder = useCallback((): string | null => {
    if (activePath !== null) return parentDir(activePath);
    return roots[0] ?? null;
  }, [activePath, roots]);

  const openRow = useCallback((row: TreeRow) => {
    if (row.kind === 'directory') {
      void useExplorer.getState().toggle(row.path);
      return;
    }
    if (isMarkdownPath(row.path)) {
      void useDocuments.getState().open(row.path);
    }
  }, []);

  /**
   * Keeps open tabs pointing at the right files after a rename or a move. Renaming a
   * folder moves every document inside it, not just the one on screen.
   */
  const followMove = useCallback((from: string, to: string) => {
    const documents = useDocuments.getState();

    for (const open of [...documents.order]) {
      if (samePath(open, from)) {
        documents.retarget(open, to);
      } else if (isInside(from, open)) {
        // Both paths come from the same provider, so the prefix matches exactly.
        documents.retarget(open, to + open.slice(from.length));
      }
    }
  }, []);

  const applyRename = useCallback(
    (target: string, nextName: string) => {
      void (async () => {
        const next = await useExplorer.getState().renameEntry(target, nextName);
        if (next !== null) followMove(target, next);
      })();
    },
    [followMove],
  );

  const applyMove = useCallback(
    (source: string, destination: string) => {
      void (async () => {
        const next = await useExplorer.getState().moveEntry(source, destination);
        if (next !== null) followMove(source, next);
      })();
    },
    [followMove],
  );

  const applyTrash = useCallback((target: string) => {
    void (async () => {
      await useExplorer.getState().trashEntry(target);

      const documents = useDocuments.getState();
      for (const open of [...documents.order]) {
        if (!samePath(open, target) && !isInside(target, open)) continue;

        // Unsaved work stays open; the "deleted on disk" bar offers to recreate it.
        if (documents.byPath[open]?.dirty === true) continue;
        documents.requestClose(open);
      }
    })();
  }, []);

  const menuItems = useCallback(
    (row: TreeRow): MenuItem[] => {
      const parent = row.kind === 'directory' ? row.path : parentDir(row.path);
      const items: MenuItem[] = [
        {
          label: 'New file…',
          disabled: parent === null,
          onSelect: () => {
            if (parent !== null) setPrompt({ kind: 'newFile', parent });
          },
        },
        {
          label: 'New folder…',
          disabled: parent === null,
          onSelect: () => {
            if (parent !== null) setPrompt({ kind: 'newFolder', parent });
          },
        },
        { label: 'Rename…', onSelect: () => setPrompt({ kind: 'rename', target: row.path }) },
        {
          label: 'Move to recycle bin',
          danger: true,
          onSelect: () => setPrompt({ kind: 'confirmTrash', target: row.path }),
        },
      ];

      if (row.isRoot) {
        items.push({
          label: 'Remove folder from workspace',
          onSelect: () => void useExplorer.getState().removeRoot(row.path),
        });
      }
      return items;
    },
    [],
  );

  return (
    <nav className="flex h-full flex-col overflow-hidden" aria-label="Explorer">
      <header className="shrink-0 border-b border-[var(--app-border)] px-2 py-2">
        <div className="flex items-center gap-1">
          <p className="flex-1 text-[11px] font-medium uppercase tracking-wider text-[var(--app-muted)]">
            Explorer
          </p>
          <button
            type="button"
            title="Add a folder to the workspace"
            onClick={() => {
              const pick = fsProvider.pickFolder?.bind(fsProvider);
              if (!pick) {
                setPrompt({ kind: 'addRoot' });
                return;
              }
              void pick().then((picked) => {
                if (picked !== null) void useExplorer.getState().addRoot(picked);
              });
            }}
            className="rounded px-1.5 py-0.5 text-xs hover:bg-[var(--app-hover)]"
          >
            + Folder
          </button>
          <button
            type="button"
            title="New markdown file"
            disabled={currentFolder() === null}
            onClick={() => {
              const parent = currentFolder();
              if (parent !== null) setPrompt({ kind: 'newFile', parent });
            }}
            className="rounded px-1.5 py-0.5 text-xs hover:bg-[var(--app-hover)] disabled:opacity-30"
          >
            + File
          </button>
          <button
            type="button"
            title="Collapse all"
            onClick={() => useExplorer.getState().collapseAll()}
            className="rounded px-1.5 py-0.5 text-xs hover:bg-[var(--app-hover)]"
          >
            ⌃
          </button>
        </div>

        <input
          value={filter}
          placeholder="Filter open folders"
          aria-label="Filter"
          onChange={(event) => useExplorer.getState().setFilter(event.target.value)}
          className="mt-2 w-full rounded border border-[var(--app-border)] bg-transparent px-2 py-1 text-xs outline-none focus:border-[var(--app-accent)]"
        />

        <div className="mt-2 flex gap-3 text-[11px] text-[var(--app-muted)]">
          <label className="flex items-center gap-1">
            <input
              type="checkbox"
              checked={markdownOnly}
              onChange={(event) => useExplorer.getState().setMarkdownOnly(event.target.checked)}
            />
            Markdown only
          </label>
          <label className="flex items-center gap-1">
            <input
              type="checkbox"
              checked={showHidden}
              onChange={(event) => useExplorer.getState().setShowHidden(event.target.checked)}
            />
            Hidden
          </label>
        </div>
      </header>

      {prompt?.kind === 'addRoot' && (
        <NamePrompt
          label="Folder path to add"
          initialValue=""
          confirmLabel="Add"
          onConfirm={(value) => {
            setPrompt(null);
            void useExplorer.getState().addRoot(value);
          }}
          onCancel={() => setPrompt(null)}
        />
      )}

      {(prompt?.kind === 'newFile' || prompt?.kind === 'newFolder') && (
        <NamePrompt
          label={prompt.kind === 'newFile' ? `New file in ${basename(prompt.parent)}` : `New folder in ${basename(prompt.parent)}`}
          initialValue={prompt.kind === 'newFile' ? 'untitled.md' : 'new-folder'}
          selectLength={prompt.kind === 'newFile' ? 'untitled'.length : undefined}
          confirmLabel="Create"
          onConfirm={(value) => {
            const { parent, kind } = prompt;
            setPrompt(null);
            if (kind === 'newFolder') {
              void useExplorer.getState().createFolder(parent, value);
              return;
            }
            void (async () => {
              const created = await useExplorer.getState().createFile(parent, value);
              if (created !== null && isMarkdownPath(created)) {
                void useDocuments.getState().open(created);
              }
            })();
          }}
          onCancel={() => setPrompt(null)}
        />
      )}

      {prompt?.kind === 'rename' && (
        <NamePrompt
          label={`Rename ${basename(prompt.target)}`}
          initialValue={basename(prompt.target)}
          selectLength={stemLength(basename(prompt.target))}
          confirmLabel="Rename"
          onConfirm={(value) => {
            const { target } = prompt;
            setPrompt(null);
            applyRename(target, value);
          }}
          onCancel={() => setPrompt(null)}
        />
      )}

      {prompt?.kind === 'confirmTrash' && (
        <div className="flex shrink-0 flex-col gap-2 border-b border-[var(--app-border)] px-2 py-2 text-xs">
          <span>
            Move <strong>{basename(prompt.target)}</strong> to the recycle bin?
          </span>
          <span className="flex gap-1">
            <button
              type="button"
              onClick={() => {
                const { target } = prompt;
                setPrompt(null);
                applyTrash(target);
              }}
              className="rounded border border-red-500/50 px-2 py-0.5 text-red-200 hover:bg-red-500/20"
            >
              Move to recycle bin
            </button>
            <button
              type="button"
              onClick={() => setPrompt(null)}
              className="rounded px-2 py-0.5 text-[var(--app-muted)] hover:bg-[var(--app-hover)]"
            >
              Cancel
            </button>
          </span>
        </div>
      )}

      {error !== null && (
        <div role="alert" className="flex shrink-0 items-start gap-2 border-b border-red-500/40 bg-red-500/10 px-2 py-1 text-[11px] text-red-200">
          <span className="min-w-0 flex-1 break-words">{error}</span>
          <button type="button" onClick={() => useExplorer.getState().clearError()} className="shrink-0 underline">
            Dismiss
          </button>
        </div>
      )}

      <div ref={scroller} className="min-h-0 flex-1 overflow-auto">
        {rows.length === 0 ? (
          <p className="px-3 py-4 text-xs text-[var(--app-muted)]">
            {roots.length === 0 ? 'No folders yet. Use “+ Folder”.' : 'Nothing matches.'}
          </p>
        ) : (
          <div style={{ height: virtualizer.getTotalSize(), position: 'relative' }}>
            {virtualizer.getVirtualItems().map((item) => {
              const row = rows[item.index];
              if (!row) return null;

              const isActive = activePath !== null && samePath(activePath, row.path);
              const openable = row.kind === 'directory' || isMarkdownPath(row.path);

              return (
                <div
                  key={row.path}
                  style={{
                    position: 'absolute',
                    top: 0,
                    left: 0,
                    width: '100%',
                    height: ROW_HEIGHT,
                    transform: `translateY(${String(item.start)}px)`,
                  }}
                >
                  <button
                    type="button"
                    draggable={!row.isRoot}
                    title={row.path}
                    onClick={() => openRow(row)}
                    onContextMenu={(event) => {
                      event.preventDefault();
                      setMenu({ x: event.clientX, y: event.clientY, row });
                    }}
                    onDragStart={(event) => {
                      event.dataTransfer.setData('text/md-studio-path', row.path);
                      event.dataTransfer.effectAllowed = 'move';
                    }}
                    onDragOver={(event) => {
                      if (row.kind !== 'directory') return;
                      if (!event.dataTransfer.types.includes('text/md-studio-path')) return;
                      event.preventDefault();
                      event.dataTransfer.dropEffect = 'move';
                      setDropTarget(row.path);
                    }}
                    onDragLeave={() => setDropTarget((current) => (current === row.path ? null : current))}
                    onDrop={(event) => {
                      if (row.kind !== 'directory') return;
                      event.preventDefault();
                      setDropTarget(null);
                      const source = event.dataTransfer.getData('text/md-studio-path');
                      if (source.length > 0) applyMove(source, row.path);
                    }}
                    style={{ paddingLeft: `${String(6 + row.depth * 12)}px` }}
                    className={[
                      'flex h-full w-full items-center gap-1 pr-2 text-left text-[13px]',
                      openable ? 'hover:bg-[var(--app-hover)]' : 'cursor-default opacity-40',
                      isActive ? 'bg-[var(--app-accent-soft)] text-[var(--app-text)]' : '',
                      dropTarget === row.path ? 'outline outline-1 outline-[var(--app-accent)]' : '',
                      row.isRoot ? 'font-medium' : '',
                    ].join(' ')}
                  >
                    <span aria-hidden className="w-3 shrink-0 text-[10px] text-[var(--app-muted)]">
                      {row.kind === 'directory' ? (row.expanded ? '▾' : '▸') : ''}
                    </span>
                    <span className="truncate">{row.name}</span>
                    {row.loading && <span className="text-[10px] text-[var(--app-muted)]">…</span>}
                    {isActive && dirty && (
                      <span aria-label="Unsaved changes" className="ml-auto size-1.5 shrink-0 rounded-full bg-[var(--app-accent)]" />
                    )}
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {menu && (
        <ContextMenu x={menu.x} y={menu.y} items={menuItems(menu.row)} onClose={() => setMenu(null)} />
      )}
    </nav>
  );
}

/** "notes.md" -> 5, so a rename selects the name and leaves the extension alone. */
function stemLength(name: string): number {
  const dot = name.lastIndexOf('.');
  return dot > 0 ? dot : name.length;
}
