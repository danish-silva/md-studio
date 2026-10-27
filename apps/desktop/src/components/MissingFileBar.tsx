export interface MissingFileBarProps {
  name: string;
  dirty: boolean;
  onRecreate: () => void;
  onClose: () => void;
}

/**
 * The open file disappeared from disk — deleted, moved, or renamed by something else.
 * Unsaved work is still in the editor, so the way out is to write it back.
 */
export function MissingFileBar({ name, dirty, onRecreate, onClose }: MissingFileBarProps) {
  return (
    <div
      role="alert"
      className="flex shrink-0 flex-wrap items-center gap-3 border-b border-amber-500/40 bg-amber-500/10 px-4 py-2 text-sm"
    >
      <span className="text-amber-200">
        {name} is no longer on disk.
        {dirty ? ' Your unsaved changes are still here.' : ''}
      </span>
      <span className="flex gap-2">
        <button
          type="button"
          onClick={onRecreate}
          className="rounded border border-amber-500/50 px-2 py-0.5 text-amber-100 hover:bg-amber-500/20"
        >
          Save to recreate it
        </button>
        <button
          type="button"
          onClick={onClose}
          className="rounded border border-[var(--app-border)] px-2 py-0.5 hover:bg-[var(--app-hover)]"
        >
          Close file
        </button>
      </span>
    </div>
  );
}
