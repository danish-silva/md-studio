import { useEffect } from 'react';
import { useDocuments } from '../state/documents';
import { recordSnapshot, useHistory } from '../state/history';

/**
 * Versions of the open file, recorded on every save.
 *
 * Independent of git, so it works in folders that are not repositories, and restoring
 * snapshots the current text first — going back is itself undoable.
 */
export function HistoryPanel() {
  const doc = useDocuments((state) =>
    state.activePath === null ? null : (state.byPath[state.activePath] ?? null),
  );
  const { entries, loading, preview, error } = useHistory();
  const path = doc?.path ?? null;

  useEffect(() => {
    if (path !== null) void useHistory.getState().load(path);
  }, [path, doc?.revision, doc?.savedText]);

  if (doc === null || path === null) {
    return <p className="px-3 py-3 text-xs text-[var(--app-muted)]">No document open.</p>;
  }

  const restore = (text: string) => {
    void (async () => {
      // The state being replaced becomes a version too, so this is never a one-way door.
      await recordSnapshot(path, doc.text);
      useDocuments.getState().replaceText(path, text);
      useHistory.getState().closePreview();
      await useHistory.getState().load(path);
    })();
  };

  return (
    <div className="flex h-full flex-col overflow-hidden">
      {error !== null && (
        <p role="alert" className="shrink-0 px-2 py-1 text-[11px] text-red-300">
          {error}
        </p>
      )}

      {entries.length === 0 && !loading && (
        <p className="px-3 py-3 text-xs text-[var(--app-muted)]">
          No versions yet. One is kept each time you save.
        </p>
      )}

      <ul className="min-h-0 flex-1 overflow-y-auto py-1">
        {entries.map((entry, index) => (
          <li key={entry.hash} className="border-b border-[var(--app-border)]/50">
            <button
              type="button"
              onClick={() => void useHistory.getState().showPreview(entry.hash)}
              className={[
                'flex w-full items-baseline gap-2 px-2 py-1.5 text-left text-[11px]',
                preview?.hash === entry.hash ? 'bg-[var(--app-accent-soft)]' : 'hover:bg-[var(--app-hover)]',
              ].join(' ')}
            >
              <span className="flex-1 truncate">
                {new Date(entry.savedAt).toLocaleString()}
                {index === 0 && <span className="ml-1 text-[var(--app-muted)]">· latest</span>}
              </span>
              <span className="shrink-0 text-[var(--app-muted)]">
                {entry.size.toLocaleString()} ch
              </span>
            </button>
          </li>
        ))}
      </ul>

      {preview !== null && (
        <div className="flex max-h-[45%] shrink-0 flex-col border-t border-[var(--app-border)]">
          <div className="flex shrink-0 items-center gap-1 px-2 py-1">
            <span className="flex-1 text-[11px] text-[var(--app-muted)]">Preview</span>
            <button
              type="button"
              onClick={() => restore(preview.text)}
              className="rounded border border-[var(--app-border)] px-2 py-0.5 text-[11px] hover:bg-[var(--app-hover)]"
            >
              Restore
            </button>
            <button
              type="button"
              onClick={() => useHistory.getState().closePreview()}
              className="rounded px-1.5 py-0.5 text-[11px] text-[var(--app-muted)] hover:bg-[var(--app-hover)]"
            >
              ✕
            </button>
          </div>
          <pre className="min-h-0 flex-1 overflow-auto whitespace-pre-wrap px-2 pb-2 font-mono text-[10px] text-[var(--app-muted)]">
            {preview.text}
          </pre>
        </div>
      )}
    </div>
  );
}
