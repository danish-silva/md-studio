import type { FileStat } from '../fs/types';

export interface ConflictBarProps {
  conflict: FileStat;
  onReload: () => void;
  onOverwrite: () => void;
}

/**
 * Shown when a save was refused because the file changed on disk — an external editor, a
 * git operation, or a sync client. P4 extends this with a diff view.
 */
export function ConflictBar({ conflict, onReload, onOverwrite }: ConflictBarProps) {
  const changedAt = new Date(conflict.mtimeMs).toLocaleTimeString();

  return (
    <div
      role="alert"
      className="flex shrink-0 flex-wrap items-center gap-3 border-b border-amber-500/40 bg-amber-500/10 px-4 py-2 text-sm"
    >
      <span className="text-amber-200">
        This file changed on disk at {changedAt}. Saving would discard those changes.
      </span>
      <span className="flex gap-2">
        <button
          type="button"
          onClick={onReload}
          className="rounded border border-[var(--app-border)] px-2 py-0.5 hover:bg-[var(--app-hover)]"
        >
          Reload from disk
        </button>
        <button
          type="button"
          onClick={onOverwrite}
          className="rounded border border-amber-500/50 px-2 py-0.5 text-amber-100 hover:bg-amber-500/20"
        >
          Keep mine and overwrite
        </button>
      </span>
    </div>
  );
}
