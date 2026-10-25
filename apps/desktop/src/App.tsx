import { useCallback, useEffect, useRef } from 'react';
import { ConflictBar } from './components/ConflictBar';
import { Explorer } from './components/Explorer';
import { MissingFileBar } from './components/MissingFileBar';
import { SourceEditor } from './components/SourceEditor';
import { StatusBar } from './components/StatusBar';
import { TabList } from './components/TabList';
import { WysiwygPane } from './components/WysiwygPane';
import { fsProvider } from './fs';
import { basename } from './lib/text';
import { useDocuments } from './state/documents';
import { DraftRecoveryBar } from './components/DraftRecoveryBar';
import { WorkspaceSwitcher } from './components/WorkspaceSwitcher';
import { useLayout } from './state/layout';
import { startWatching } from './state/watcher';
import { useWorkspace } from './state/workspace';

/** How often forgotten tabs are swept up. The threshold itself is in days. */
const ARCHIVE_INTERVAL_MS = 5 * 60 * 1000;

export function App() {
  const activePath = useDocuments((state) => state.activePath);
  const doc = useDocuments((state) => (state.activePath === null ? null : state.byPath[state.activePath] ?? null));
  const pendingClose = useDocuments((state) => state.pendingClose);
  const busy = useDocuments((state) => state.busy);
  const error = useDocuments((state) => state.error);

  const pendingDrafts = useWorkspace((state) => state.pendingDrafts);
  const droppedTabs = useWorkspace((state) => state.droppedTabs);
  const workspaceError = useWorkspace((state) => state.error);

  const sidebarWidth = useLayout((state) => state.sidebarWidth);
  const sidebarCollapsed = useLayout((state) => state.sidebarCollapsed);

  useEffect(() => {
    // The workspace owns which folders are open, so it boots before anything reads them.
    void useWorkspace.getState().boot();

    const stopWatching = startWatching();
    const stopAutosave = useWorkspace.getState().startAutosave();
    return () => {
      stopWatching();
      stopAutosave();
    };
  }, []);

  useEffect(() => {
    const documents = useDocuments.getState();
    documents.archiveStale();
    const timer = setInterval(() => useDocuments.getState().archiveStale(), ARCHIVE_INTERVAL_MS);
    return () => clearInterval(timer);
  }, []);

  // Handled once, at the window, so they work wherever focus is and the browser's own
  // shortcuts never fire. Ctrl+B belongs to Bold, so the sidebar toggle lives on Ctrl+\.
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      const documents = useDocuments.getState();

      // Alt+Up/Down as well as Ctrl+Tab, because a browser keeps Ctrl+Tab for itself.
      if (event.altKey && !event.ctrlKey && !event.metaKey) {
        if (event.key === 'ArrowDown') {
          event.preventDefault();
          documents.activateRelative(1);
        } else if (event.key === 'ArrowUp') {
          event.preventDefault();
          documents.activateRelative(-1);
        }
        return;
      }

      if (!event.ctrlKey && !event.metaKey) return;

      if (event.key === 'Tab') {
        event.preventDefault();
        documents.activateRelative(event.shiftKey ? -1 : 1);
        return;
      }

      const key = event.key.toLowerCase();
      if (key === 's') {
        event.preventDefault();
        void (event.shiftKey ? documents.saveAll() : documents.save());
      } else if (key === 'w') {
        event.preventDefault();
        if (documents.activePath !== null) documents.requestClose(documents.activePath);
      } else if (key === 'm' && event.shiftKey) {
        event.preventDefault();
        documents.toggleMode();
      } else if (key === '\\') {
        event.preventDefault();
        useLayout.getState().toggleSidebar();
      }
    }

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  return (
    <div className="flex h-full flex-col bg-[var(--app-bg)] text-[var(--app-text)]">
      <div className="flex min-h-0 flex-1">
        {!sidebarCollapsed && (
          <>
            <aside
              style={{ width: sidebarWidth }}
              className="flex shrink-0 flex-col overflow-hidden border-r border-[var(--app-border)] bg-[var(--app-panel)]"
            >
              <WorkspaceSwitcher />
              <TabList />
              <div className="min-h-0 flex-1">
                <Explorer />
              </div>
            </aside>
            <SidebarResizer />
          </>
        )}

        <main className="flex min-w-0 flex-1 flex-col">
          <header className="flex shrink-0 items-center gap-2 border-b border-[var(--app-border)] px-4 py-2">
            <h1 className="truncate text-sm font-medium" title={doc?.path ?? ''}>
              {doc ? basename(doc.path) : 'md-studio'}
            </h1>
            {doc?.dirty === true && (
              <span
                aria-label="Unsaved changes"
                className="size-1.5 rounded-full bg-[var(--app-accent)]"
              />
            )}
            <button
              type="button"
              disabled={doc === null}
              onClick={() => useDocuments.getState().toggleMode()}
              title="Toggle source mode (Ctrl+Shift+M)"
              className="ml-auto rounded border border-[var(--app-border)] px-2 py-0.5 text-xs text-[var(--app-muted)] hover:bg-[var(--app-hover)] disabled:opacity-40"
            >
              {doc?.mode === 'source' ? 'Markdown source' : 'Formatted'}
            </button>
          </header>

          {error !== null && (
            <div
              role="alert"
              className="flex shrink-0 items-center gap-3 border-b border-red-500/40 bg-red-500/10 px-4 py-2 text-sm text-red-200"
            >
              <span className="min-w-0 flex-1 break-words">{error}</span>
              <button
                type="button"
                onClick={() => useDocuments.getState().clearError()}
                className="rounded border border-[var(--app-border)] px-2 py-0.5"
              >
                Dismiss
              </button>
            </div>
          )}

          {pendingDrafts.length > 0 && (
            <DraftRecoveryBar
              drafts={pendingDrafts}
              onKeep={() => void useWorkspace.getState().resolveDrafts('keep')}
              onDiscard={() => void useWorkspace.getState().resolveDrafts('discard')}
            />
          )}

          {droppedTabs.length > 0 && (
            <div className="flex shrink-0 items-center gap-3 border-b border-[var(--app-border)] px-4 py-1.5 text-xs text-[var(--app-muted)]">
              <span className="min-w-0 flex-1 break-words">
                {droppedTabs.length} tab{droppedTabs.length === 1 ? '' : 's'} could not be
                reopened; {droppedTabs.length === 1 ? 'the file is' : 'those files are'} no
                longer on disk.
              </span>
              <button
                type="button"
                onClick={() => useWorkspace.getState().dismissDropped()}
                className="shrink-0 underline"
              >
                Dismiss
              </button>
            </div>
          )}

          {workspaceError !== null && (
            <div
              role="alert"
              className="flex shrink-0 items-center gap-3 border-b border-red-500/40 bg-red-500/10 px-4 py-2 text-sm text-red-200"
            >
              <span className="min-w-0 flex-1 break-words">{workspaceError}</span>
              <button
                type="button"
                onClick={() => useWorkspace.getState().clearError()}
                className="rounded border border-[var(--app-border)] px-2 py-0.5"
              >
                Dismiss
              </button>
            </div>
          )}

          {pendingClose !== null && (
            <div
              role="alert"
              className="flex shrink-0 flex-wrap items-center gap-3 border-b border-[var(--app-border)] bg-[var(--app-panel)] px-4 py-2 text-sm"
            >
              <span>{basename(pendingClose)} has unsaved changes.</span>
              <span className="flex gap-2">
                <button
                  type="button"
                  onClick={() => useDocuments.getState().resolveClose('save')}
                  className="rounded border border-[var(--app-border)] px-2 py-0.5 text-xs hover:bg-[var(--app-hover)]"
                >
                  Save and close
                </button>
                <button
                  type="button"
                  onClick={() => useDocuments.getState().resolveClose('discard')}
                  className="rounded border border-red-500/50 px-2 py-0.5 text-xs text-red-200 hover:bg-red-500/20"
                >
                  Discard changes
                </button>
                <button
                  type="button"
                  onClick={() => useDocuments.getState().resolveClose('cancel')}
                  className="rounded px-2 py-0.5 text-xs text-[var(--app-muted)] hover:bg-[var(--app-hover)]"
                >
                  Keep open
                </button>
              </span>
            </div>
          )}

          {doc?.missing === true && (
            <MissingFileBar
              name={basename(doc.path)}
              dirty={doc.dirty}
              onRecreate={() => void useDocuments.getState().save(doc.path, { force: true })}
              onClose={() => useDocuments.getState().requestClose(doc.path)}
            />
          )}

          {doc?.conflict != null && (
            <ConflictBar
              conflict={doc.conflict}
              onReload={() => void useDocuments.getState().reloadFromDisk(doc.path)}
              onOverwrite={() => void useDocuments.getState().save(doc.path, { force: true })}
            />
          )}

          <div className="min-h-0 flex-1">
            {doc && activePath !== null ? (
              doc.mode === 'wysiwyg' ? (
                <WysiwygPane
                  documentKey={`${doc.path}::${doc.revision}::wysiwyg`}
                  documentPath={doc.path}
                  initialMarkdown={doc.text}
                  onChange={(text) => useDocuments.getState().setText(doc.path, text)}
                />
              ) : (
                <SourceEditor
                  documentKey={`${doc.path}::${doc.revision}::source`}
                  documentPath={doc.path}
                  initialText={doc.text}
                  onChange={(text) => useDocuments.getState().setText(doc.path, text)}
                />
              )
            ) : (
              <p className="p-8 text-sm text-[var(--app-muted)]">
                Pick a markdown file from the explorer to start editing.
              </p>
            )}
          </div>
        </main>
      </div>

      <StatusBar doc={doc} providerId={fsProvider.id} busy={busy} />
    </div>
  );
}

/** A drag handle rather than a CSS resize, so the width can be persisted in P6. */
function SidebarResizer() {
  const dragging = useRef(false);

  const onPointerDown = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    dragging.current = true;
    event.currentTarget.setPointerCapture(event.pointerId);
  }, []);

  const onPointerMove = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    if (!dragging.current) return;
    useLayout.getState().setSidebarWidth(event.clientX);
  }, []);

  const onPointerUp = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    dragging.current = false;
    event.currentTarget.releasePointerCapture(event.pointerId);
  }, []);

  return (
    <div
      role="separator"
      aria-label="Resize sidebar"
      aria-orientation="vertical"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      className="w-1 shrink-0 cursor-col-resize bg-transparent hover:bg-[var(--app-accent)]"
    />
  );
}
