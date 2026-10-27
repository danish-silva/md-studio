import { useMemo, useState } from 'react';
import { basename } from '../lib/text';
import { sectionTabs, useDocuments, type OpenDocument } from '../state/documents';
import { useExplorer } from '../state/explorer';
import { ContextMenu, type MenuItem } from './ContextMenu';

const ARCHIVE_CHOICES = [
  { days: 0, label: 'Never' },
  { days: 1, label: 'After a day' },
  { days: 7, label: 'After a week' },
  { days: 30, label: 'After a month' },
];

interface MenuState {
  x: number;
  y: number;
  items: MenuItem[];
}

/**
 * Vertical tabs, after Arc: the active document is a filled pill with an accent bar, a
 * pinned zone sits above everything and survives closing, and the rest are grouped under
 * the workspace folder they belong to.
 */
export function TabList() {
  const order = useDocuments((state) => state.order);
  const byPath = useDocuments((state) => state.byPath);
  const activePath = useDocuments((state) => state.activePath);
  const recentlyClosed = useDocuments((state) => state.recentlyClosed);
  const autoArchiveDays = useDocuments((state) => state.autoArchiveDays);
  const roots = useExplorer((state) => state.roots);

  const [menu, setMenu] = useState<MenuState | null>(null);
  const [dragOver, setDragOver] = useState<string | null>(null);

  const sections = useMemo(() => sectionTabs(order, byPath, roots), [order, byPath, roots]);

  if (order.length === 0 && recentlyClosed.length === 0) return null;

  const openMenu = (event: React.MouseEvent, items: MenuItem[]) => {
    event.preventDefault();
    setMenu({ x: event.clientX, y: event.clientY, items });
  };

  const tabMenu = (doc: OpenDocument): MenuItem[] => [
    {
      label: doc.pinned ? 'Unpin' : 'Pin',
      onSelect: () => useDocuments.getState().togglePin(doc.path),
    },
    { label: 'Close', onSelect: () => useDocuments.getState().requestClose(doc.path) },
  ];

  const archiveMenu: MenuItem[] = ARCHIVE_CHOICES.map((choice) => ({
    label: `${choice.label}${choice.days === autoArchiveDays ? '  ✓' : ''}`,
    onSelect: () => useDocuments.getState().setAutoArchiveDays(choice.days),
  }));

  const renderTab = (path: string) => {
    const doc = byPath[path];
    if (!doc) return null;

    const isActive = path === activePath;

    return (
      <li key={path} className="relative">
        <div
          className={[
            'group relative flex items-center rounded',
            isActive ? 'bg-[var(--app-accent-soft)]' : 'hover:bg-[var(--app-hover)]',
            dragOver === path ? 'outline outline-1 outline-[var(--app-accent)]' : '',
          ].join(' ')}
          onDragOver={(event) => {
            if (!event.dataTransfer.types.includes('text/md-studio-tab')) return;
            event.preventDefault();
            event.dataTransfer.dropEffect = 'move';
            setDragOver(path);
          }}
          onDragLeave={() => setDragOver((current) => (current === path ? null : current))}
          onDrop={(event) => {
            event.preventDefault();
            setDragOver(null);
            const source = event.dataTransfer.getData('text/md-studio-tab');
            if (source.length > 0) useDocuments.getState().reorder(source, path);
          }}
        >
          {isActive && (
            <span
              aria-hidden
              className="absolute left-0 top-1 bottom-1 w-0.5 rounded-full bg-[var(--app-accent)]"
            />
          )}

          <button
            type="button"
            draggable
            title={doc.path}
            aria-current={isActive ? 'true' : undefined}
            onClick={() => useDocuments.getState().activate(path)}
            onContextMenu={(event) => openMenu(event, tabMenu(doc))}
            onDragStart={(event) => {
              event.dataTransfer.setData('text/md-studio-tab', path);
              event.dataTransfer.effectAllowed = 'move';
            }}
            className="flex min-w-0 flex-1 items-center gap-1.5 py-1 pl-2.5 pr-1 text-left text-[13px]"
          >
            {doc.pinned && (
              <span aria-label="Pinned" className="shrink-0 text-[10px] text-[var(--app-muted)]">
                ◆
              </span>
            )}
            <span className={['truncate', isActive ? '' : 'text-[var(--app-muted)]'].join(' ')}>
              {basename(doc.path)}
            </span>
            {doc.missing && (
              <span title="Deleted on disk" className="shrink-0 text-[10px] text-amber-400">
                !
              </span>
            )}
          </button>

          <span className="relative mr-1 flex size-5 shrink-0 items-center justify-center">
            {doc.dirty && (
              <span
                aria-label="Unsaved changes"
                className="size-1.5 rounded-full bg-[var(--app-accent)] group-hover:hidden"
              />
            )}
            <button
              type="button"
              aria-label={`Close ${basename(doc.path)}`}
              onClick={() => useDocuments.getState().requestClose(path)}
              className={[
                'size-5 rounded text-[11px] leading-none text-[var(--app-muted)]',
                'hover:bg-[var(--app-border)] hover:text-[var(--app-text)]',
                doc.dirty ? 'hidden group-hover:block' : 'invisible group-hover:visible',
              ].join(' ')}
            >
              ✕
            </button>
          </span>
        </div>
      </li>
    );
  };

  return (
    <section
      aria-label="Open tabs"
      className="flex max-h-[45%] shrink-0 flex-col overflow-hidden border-b border-[var(--app-border)]"
    >
      <header className="flex shrink-0 items-center gap-1 px-2 pt-2">
        <p className="flex-1 text-[11px] font-medium uppercase tracking-wider text-[var(--app-muted)]">
          Tabs
        </p>
        <button
          type="button"
          title="Archive tabs left untouched"
          onClick={(event) => openMenu(event, archiveMenu)}
          className="rounded px-1.5 text-xs text-[var(--app-muted)] hover:bg-[var(--app-hover)]"
        >
          ⋯
        </button>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto px-1.5 pb-2">
        {sections.pinned.length > 0 && (
          <>
            <GroupLabel>Pinned</GroupLabel>
            <ul>{sections.pinned.map(renderTab)}</ul>
          </>
        )}

        {sections.groups.map((group) => (
          <div key={group.root ?? 'other'}>
            <GroupLabel>{group.label}</GroupLabel>
            <ul>{group.paths.map(renderTab)}</ul>
          </div>
        ))}

        {recentlyClosed.length > 0 && (
          <>
            <GroupLabel
              action={{
                label: 'Clear',
                onSelect: () => useDocuments.getState().clearRecentlyClosed(),
              }}
            >
              Recently closed
            </GroupLabel>
            <ul>
              {recentlyClosed.map((tab) => (
                <li key={tab.path}>
                  <button
                    type="button"
                    title={`Reopen ${tab.path}`}
                    onClick={() => void useDocuments.getState().reopen(tab.path)}
                    className="flex w-full items-center rounded py-1 pl-2.5 pr-1 text-left text-[13px] text-[var(--app-muted)] opacity-60 hover:bg-[var(--app-hover)] hover:opacity-100"
                  >
                    <span className="truncate">{basename(tab.path)}</span>
                  </button>
                </li>
              ))}
            </ul>
          </>
        )}
      </div>

      {menu && <ContextMenu x={menu.x} y={menu.y} items={menu.items} onClose={() => setMenu(null)} />}
    </section>
  );
}

function GroupLabel({
  children,
  action,
}: {
  children: React.ReactNode;
  action?: { label: string; onSelect: () => void } | undefined;
}) {
  return (
    <p className="flex items-center gap-2 px-2.5 pb-0.5 pt-2 text-[10px] uppercase tracking-wider text-[var(--app-muted)]">
      <span className="truncate">{children}</span>
      {action && (
        <button type="button" onClick={action.onSelect} className="ml-auto shrink-0 underline">
          {action.label}
        </button>
      )}
    </p>
  );
}
