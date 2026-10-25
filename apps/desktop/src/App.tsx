import { useEffect } from 'react';
import { ConflictBar } from './components/ConflictBar';
import { FileList } from './components/FileList';
import { SourceEditor } from './components/SourceEditor';
import { StatusBar } from './components/StatusBar';
import { fsProvider } from './fs';
import { basename } from './lib/text';
import { useSession } from './state/session';

export function App() {
  const state = useSession();
  const { doc, conflict } = state;

  useEffect(() => {
    void useSession.getState().init();
  }, []);

  // Ctrl+S is handled once, at the window, so it works whether or not the editor has focus
  // and so the browser's own save dialog never opens. P2 adds the full shortcut map.
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
        event.preventDefault();
        void useSession.getState().save();
      }
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  return (
    <div className="flex h-full flex-col bg-[var(--app-bg)] text-[var(--app-text)]">
      <div className="flex min-h-0 flex-1">
        <aside className="w-64 shrink-0 border-r border-[var(--app-border)] bg-[var(--app-panel)]">
          <FileList
            dirPath={state.dirPath}
            entries={state.entries}
            activePath={doc?.path ?? null}
            onOpenDir={(dirPath) => void state.openDir(dirPath)}
            onOpenFile={(filePath) => void state.openFile(filePath)}
          />
        </aside>

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
            <span className="ml-auto text-xs text-[var(--app-muted)]">
              Source mode · Ctrl+S to save
            </span>
          </header>

          {state.error !== null && (
            <div
              role="alert"
              className="flex shrink-0 items-center gap-3 border-b border-red-500/40 bg-red-500/10 px-4 py-2 text-sm text-red-200"
            >
              <span className="min-w-0 flex-1 break-words">{state.error}</span>
              <button
                type="button"
                onClick={state.clearError}
                className="rounded border border-[var(--app-border)] px-2 py-0.5"
              >
                Dismiss
              </button>
            </div>
          )}

          {conflict !== null && (
            <ConflictBar
              conflict={conflict}
              onReload={() => void state.reloadFromDisk()}
              onOverwrite={() => void state.save({ force: true })}
            />
          )}

          <div className="min-h-0 flex-1">
            {doc ? (
              <SourceEditor
                documentKey={`${doc.path}::${doc.revision}`}
                initialText={doc.text}
                onChange={state.setText}
              />
            ) : (
              <p className="p-8 text-sm text-[var(--app-muted)]">
                Pick a markdown file from the explorer to start editing.
              </p>
            )}
          </div>
        </main>
      </div>

      <StatusBar doc={doc} providerId={fsProvider.id} busy={state.busy} />
    </div>
  );
}
