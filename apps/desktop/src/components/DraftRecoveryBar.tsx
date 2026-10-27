import { basename } from '../lib/text';
import type { PendingDraft } from '../state/workspace';

export interface DraftRecoveryBarProps {
  drafts: PendingDraft[];
  onKeep: () => void;
  onDiscard: () => void;
}

/**
 * Unsaved buffers from a session that ended without saving them.
 *
 * Nothing is applied until the user says so, and discarding only removes the cached
 * draft — the file on disk is never touched either way.
 */
export function DraftRecoveryBar({ drafts, onKeep, onDiscard }: DraftRecoveryBarProps) {
  const names = drafts.map((draft) => basename(draft.path)).join(', ');

  return (
    <div
      role="alert"
      className="flex shrink-0 flex-wrap items-center gap-3 border-b border-[var(--app-accent)]/50 bg-[var(--app-accent-soft)] px-4 py-2 text-sm"
    >
      <span>
        {drafts.length === 1 ? 'An unsaved document' : `${String(drafts.length)} unsaved documents`}{' '}
        from your last session {drafts.length === 1 ? 'was' : 'were'} recovered: {names}.
      </span>
      <span className="flex gap-2">
        <button
          type="button"
          onClick={onKeep}
          className="rounded border border-[var(--app-accent)]/60 px-2 py-0.5 text-xs hover:bg-[var(--app-hover)]"
        >
          Restore them
        </button>
        <button
          type="button"
          onClick={onDiscard}
          className="rounded border border-[var(--app-border)] px-2 py-0.5 text-xs text-[var(--app-muted)] hover:bg-[var(--app-hover)]"
        >
          Discard drafts
        </button>
      </span>
    </div>
  );
}
