import { useEffect, useMemo, useState } from 'react';
import { basename } from '../lib/text';
import { useDocuments } from '../state/documents';
import { useExplorer } from '../state/explorer';
import { useGit, type GitEntry } from '../state/git';

const LABELS: Record<GitEntry['status'], string> = {
  modified: 'M',
  added: 'A',
  deleted: 'D',
  renamed: 'R',
  untracked: '?',
  conflicted: '!',
};

export function GitPanel() {
  const { root, branch, entries, busy, error } = useGit();
  const roots = useExplorer((state) => state.roots);
  const [message, setMessage] = useState('');

  useEffect(() => {
    const folder = roots[0];
    if (folder !== undefined && root === null) void useGit.getState().detect(folder);
  }, [roots, root]);

  const staged = useMemo(() => entries.filter((entry) => entry.staged), [entries]);
  const unstaged = useMemo(() => entries.filter((entry) => !entry.staged), [entries]);

  if (roots.length === 0) {
    return <p className="px-3 py-3 text-xs text-[var(--app-muted)]">No folder open.</p>;
  }

  if (root === null) {
    return (
      <div className="space-y-2 px-3 py-3 text-xs text-[var(--app-muted)]">
        <p>This folder is not a git repository.</p>
        <button
          type="button"
          onClick={() => {
            const folder = roots[0];
            if (folder !== undefined) void useGit.getState().detect(folder);
          }}
          className="rounded border border-[var(--app-border)] px-2 py-0.5 hover:bg-[var(--app-hover)]"
        >
          Check again
        </button>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col overflow-hidden text-xs">
      <header className="flex shrink-0 items-center gap-2 border-b border-[var(--app-border)] px-2 py-1.5">
        <span className="truncate" title={root}>
          <span className="text-[var(--app-muted)]">on </span>
          {branch ?? 'detached'}
        </span>
        <button
          type="button"
          disabled={busy}
          onClick={() => void useGit.getState().refresh()}
          className="ml-auto rounded px-1.5 py-0.5 text-[var(--app-muted)] hover:bg-[var(--app-hover)] disabled:opacity-40"
        >
          {busy ? '…' : 'Refresh'}
        </button>
      </header>

      {error !== null && (
        <div role="alert" className="flex shrink-0 items-start gap-2 border-b border-red-500/40 bg-red-500/10 px-2 py-1 text-[11px] text-red-200">
          <span className="min-w-0 flex-1 whitespace-pre-wrap break-words">{error}</span>
          <button type="button" onClick={() => useGit.getState().clearError()} className="shrink-0 underline">
            Dismiss
          </button>
        </div>
      )}

      <div className="min-h-0 flex-1 overflow-y-auto">
        <Group
          title={`Staged (${String(staged.length)})`}
          entries={staged}
          action="Unstage"
          onAction={(path) => void useGit.getState().unstage(path)}
        />
        <Group
          title={`Changes (${String(unstaged.length)})`}
          entries={unstaged}
          action="Stage"
          onAction={(path) => void useGit.getState().stage(path)}
          extra={
            unstaged.length > 0 ? (
              <button
                type="button"
                onClick={() => void useGit.getState().stageAll()}
                className="shrink-0 underline"
              >
                Stage all
              </button>
            ) : null
          }
        />

        {entries.length === 0 && (
          <p className="px-3 py-3 text-[var(--app-muted)]">Nothing to commit.</p>
        )}
      </div>

      <form
        className="shrink-0 space-y-1 border-t border-[var(--app-border)] p-2"
        onSubmit={(event) => {
          event.preventDefault();
          void useGit
            .getState()
            .commit(message)
            .then((ok) => {
              if (ok) setMessage('');
            });
        }}
      >
        <textarea
          value={message}
          rows={2}
          placeholder="Commit message"
          aria-label="Commit message"
          onChange={(event) => setMessage(event.target.value)}
          className="w-full resize-none rounded border border-[var(--app-border)] bg-transparent px-2 py-1 outline-none focus:border-[var(--app-accent)]"
        />
        <button
          type="submit"
          disabled={busy || staged.length === 0 || message.trim().length === 0}
          className="w-full rounded border border-[var(--app-border)] px-2 py-1 hover:bg-[var(--app-hover)] disabled:opacity-40"
        >
          Commit {staged.length > 0 ? `${String(staged.length)} file${staged.length === 1 ? '' : 's'}` : ''}
        </button>
      </form>
    </div>
  );
}

function Group({
  title,
  entries,
  action,
  onAction,
  extra,
}: {
  title: string;
  entries: GitEntry[];
  action: string;
  onAction: (path: string) => void;
  extra?: React.ReactNode;
}) {
  if (entries.length === 0) return null;

  return (
    <section>
      <p className="flex items-center gap-2 px-2 pb-0.5 pt-2 text-[10px] uppercase tracking-wider text-[var(--app-muted)]">
        <span className="truncate">{title}</span>
        {extra}
      </p>
      <ul>
        {entries.map((entry) => (
          <li key={`${entry.path}:${String(entry.staged)}`} className="group flex items-center">
            <button
              type="button"
              title={entry.path}
              onClick={() => void useDocuments.getState().open(entry.path)}
              className="flex min-w-0 flex-1 items-center gap-2 px-2 py-1 text-left hover:bg-[var(--app-hover)]"
            >
              <span
                aria-label={entry.status}
                className={[
                  'w-3 shrink-0 text-center font-mono text-[10px]',
                  entry.status === 'untracked' ? 'text-[var(--app-muted)]' : 'text-amber-400',
                ].join(' ')}
              >
                {LABELS[entry.status]}
              </span>
              <span className="truncate">{basename(entry.path)}</span>
            </button>
            <button
              type="button"
              onClick={() => onAction(entry.path)}
              className="invisible mr-1 shrink-0 rounded px-1.5 py-0.5 text-[10px] text-[var(--app-muted)] hover:bg-[var(--app-border)] group-hover:visible"
            >
              {action}
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
