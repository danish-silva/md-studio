import { useCallback, useEffect, useRef, useState } from 'react';
import { CommandPalette } from './components/CommandPalette';
import { DraftRecoveryBar } from './components/DraftRecoveryBar';
import { EditorPane } from './components/EditorPane';
import { FindBar } from './components/FindBar';
import { SettingsDialog } from './components/SettingsDialog';
import { Sidebar } from './components/Sidebar';
import { StatusBar } from './components/StatusBar';
import { fsProvider } from './fs';
import { basename } from './lib/text';
import { applyTheme } from './lib/theme';
import { useDocuments } from './state/documents';
import { useFind } from './state/find';
import { useLayout } from './state/layout';
import { useSettings } from './state/settings';
import { startWatching } from './state/watcher';
import { useWorkspace } from './state/workspace';

/** How often forgotten tabs are swept up. The threshold itself is in days. */
const ARCHIVE_INTERVAL_MS = 5 * 60 * 1000;

export function App() {
  const doc = useDocuments((state) =>
    state.activePath === null ? null : (state.byPath[state.activePath] ?? null),
  );
  const secondaryPath = useDocuments((state) => state.secondaryPath);
  const pendingClose = useDocuments((state) => state.pendingClose);
  const busy = useDocuments((state) => state.busy);
  const error = useDocuments((state) => state.error);
  const notice = useDocuments((state) => state.notice);

  const pendingDrafts = useWorkspace((state) => state.pendingDrafts);
  const droppedTabs = useWorkspace((state) => state.droppedTabs);
  const workspaceError = useWorkspace((state) => state.error);

  const sidebarWidth = useLayout((state) => state.sidebarWidth);
  const sidebarCollapsed = useLayout((state) => state.sidebarCollapsed);
  const settingsOpen = useLayout((state) => state.settingsOpen);

  const findOpen = useFind((state) => state.open);
  const [palette, setPalette] = useState<string | null>(null);

  const theme = useSettings((state) => state.theme);
  const accent = useSettings((state) => state.accent);
  const editorFont = useSettings((state) => state.editorFont);
  const fontSize = useSettings((state) => state.fontSize);

  useEffect(() => {
    void useSettings
      .getState()
      .load()
      .then(() => applyTheme(useSettings.getState()));

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
    applyTheme(useSettings.getState());
  }, [theme, accent, editorFont, fontSize]);

  // "Match the system" has to keep matching it.
  useEffect(() => {
    const query = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = () => {
      if (useSettings.getState().theme === 'system') applyTheme(useSettings.getState());
    };
    query.addEventListener('change', onChange);
    return () => query.removeEventListener('change', onChange);
  }, []);

  useEffect(() => {
    useDocuments.getState().archiveStale();
    const timer = setInterval(() => useDocuments.getState().archiveStale(), ARCHIVE_INTERVAL_MS);
    return () => clearInterval(timer);
  }, []);

  // Autosave is opt-in, and saves every dirty document rather than only the one on
  // screen: with a split editor, "the current one" is ambiguous.
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;

    const stop = useDocuments.subscribe(() => {
      const { autosave, autosaveDelayMs } = useSettings.getState();
      if (!autosave) return;

      const documents = useDocuments.getState();
      if (!documents.order.some((path) => documents.byPath[path]?.dirty === true)) return;

      if (timer !== null) clearTimeout(timer);
      timer = setTimeout(() => {
        timer = null;
        void useDocuments.getState().saveAll();
      }, autosaveDelayMs);
    });

    return () => {
      stop();
      if (timer !== null) clearTimeout(timer);
    };
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
      if (event.key === ',') {
        event.preventDefault();
        useLayout.getState().setSettingsOpen(true);
        return;
      }

      const key = event.key.toLowerCase();
      if (key === 'p') {
        event.preventDefault();
        setPalette(event.shiftKey ? '>' : '');
      } else if (key === 'f' && event.shiftKey) {
        event.preventDefault();
        useLayout.getState().showSidebarPanel('search');
      } else if (key === 'f') {
        event.preventDefault();
        useFind.getState().openFind(false);
      } else if (key === 'h') {
        event.preventDefault();
        useFind.getState().openFind(true);
      } else if (key === 'e' && event.shiftKey) {
        event.preventDefault();
        useLayout.getState().showSidebarPanel('files');
      } else if (key === 's') {
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
              <Sidebar />
            </aside>
            <SidebarResizer />
          </>
        )}

        <main className="flex min-w-0 flex-1 flex-col">
          {findOpen && <FindBar />}

          {pendingDrafts.length > 0 && (
            <DraftRecoveryBar
              drafts={pendingDrafts}
              onKeep={() => void useWorkspace.getState().resolveDrafts('keep')}
              onDiscard={() => void useWorkspace.getState().resolveDrafts('discard')}
            />
          )}

          {notice !== null && (
            <Notice onDismiss={() => useDocuments.getState().clearNotice()}>{notice}</Notice>
          )}

          {droppedTabs.length > 0 && (
            <Notice onDismiss={() => useWorkspace.getState().dismissDropped()}>
              {droppedTabs.length} tab{droppedTabs.length === 1 ? '' : 's'} could not be reopened;{' '}
              {droppedTabs.length === 1 ? 'the file is' : 'those files are'} no longer on disk.
            </Notice>
          )}

          {(error ?? workspaceError) !== null && (
            <div
              role="alert"
              className="flex shrink-0 items-center gap-3 border-b border-red-500/40 bg-red-500/10 px-4 py-2 text-sm text-red-200"
            >
              <span className="min-w-0 flex-1 break-words">{error ?? workspaceError}</span>
              <button
                type="button"
                onClick={() => {
                  useDocuments.getState().clearError();
                  useWorkspace.getState().clearError();
                }}
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

          <div className="flex min-h-0 flex-1">
            <EditorPane pane="primary" showPaneControls={secondaryPath !== null} />
            {secondaryPath !== null && (
              <>
                <div className="w-px shrink-0 bg-[var(--app-border)]" />
                <EditorPane pane="secondary" showPaneControls />
              </>
            )}
          </div>
        </main>
      </div>

      <StatusBar doc={doc} providerId={fsProvider.id} busy={busy} />

      {palette !== null && (
        <CommandPalette initialValue={palette} onClose={() => setPalette(null)} />
      )}
      {settingsOpen && <SettingsDialog onClose={() => useLayout.getState().setSettingsOpen(false)} />}
    </div>
  );
}

function Notice({ children, onDismiss }: { children: React.ReactNode; onDismiss: () => void }) {
  return (
    <div className="flex shrink-0 items-center gap-3 border-b border-[var(--app-border)] px-4 py-1.5 text-xs text-[var(--app-muted)]">
      <span className="min-w-0 flex-1 break-words">{children}</span>
      <button type="button" onClick={onDismiss} className="shrink-0 underline">
        Dismiss
      </button>
    </div>
  );
}

/** A drag handle rather than a CSS resize, so the width can be persisted. */
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
