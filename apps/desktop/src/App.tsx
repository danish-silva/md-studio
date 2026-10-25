import { useCallback, useEffect, useRef } from 'react';
import { ConflictBar } from './components/ConflictBar';
import { Explorer } from './components/Explorer';
import { MissingFileBar } from './components/MissingFileBar';
import { SourceEditor } from './components/SourceEditor';
import { StatusBar } from './components/StatusBar';
import { WysiwygPane } from './components/WysiwygPane';
import { fsProvider } from './fs';
import { basename } from './lib/text';
import { useExplorer } from './state/explorer';
import { useLayout } from './state/layout';
import { useSession } from './state/session';
import { startWatching } from './state/watcher';

export function App() {
  const doc = useSession((state) => state.doc);
  const mode = useSession((state) => state.mode);
  const conflict = useSession((state) => state.conflict);
  const missing = useSession((state) => state.missing);
  const busy = useSession((state) => state.busy);
  const error = useSession((state) => state.error);

  const sidebarWidth = useLayout((state) => state.sidebarWidth);
  const sidebarCollapsed = useLayout((state) => state.sidebarCollapsed);

  useEffect(() => {
    void useExplorer.getState().init();
    return startWatching();
  }, []);

  // Ctrl+S and Ctrl+Shift+M are handled once, at the window, so they work whether or not
  // the editor has focus and the browser's own save dialog never opens. Ctrl+B belongs to
  // Bold, so the sidebar toggle lives on Ctrl+\.
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (!event.ctrlKey && !event.metaKey) return;
      const key = event.key.toLowerCase();

      if (key === 's') {
        event.preventDefault();
        void useSession.getState().save();
      } else if (key === 'm' && event.shiftKey) {
        event.preventDefault();
        useSession.getState().toggleMode();
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
              className="shrink-0 border-r border-[var(--app-border)] bg-[var(--app-panel)]"
            >
              <Explorer />
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
              onClick={() => useSession.getState().toggleMode()}
              title="Toggle source mode (Ctrl+Shift+M)"
              className="ml-auto rounded border border-[var(--app-border)] px-2 py-0.5 text-xs text-[var(--app-muted)] hover:bg-[var(--app-hover)]"
            >
              {mode === 'wysiwyg' ? 'Formatted' : 'Markdown source'}
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
                onClick={() => useSession.getState().clearError()}
                className="rounded border border-[var(--app-border)] px-2 py-0.5"
              >
                Dismiss
              </button>
            </div>
          )}

          {missing && doc && (
            <MissingFileBar
              name={basename(doc.path)}
              dirty={doc.dirty}
              onRecreate={() => void useSession.getState().save({ force: true })}
              onClose={() => useSession.getState().closeFile()}
            />
          )}

          {conflict !== null && (
            <ConflictBar
              conflict={conflict}
              onReload={() => void useSession.getState().reloadFromDisk()}
              onOverwrite={() => void useSession.getState().save({ force: true })}
            />
          )}

          <div className="min-h-0 flex-1">
            {doc ? (
              mode === 'wysiwyg' ? (
                <WysiwygPane
                  documentKey={`${doc.path}::${doc.revision}::wysiwyg`}
                  documentPath={doc.path}
                  initialMarkdown={doc.text}
                  onChange={useSession.getState().setText}
                />
              ) : (
                <SourceEditor
                  documentKey={`${doc.path}::${doc.revision}::source`}
                  initialText={doc.text}
                  onChange={useSession.getState().setText}
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
