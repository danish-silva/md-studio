import { useEffect, useRef, useState } from 'react';

export interface NamePromptProps {
  label: string;
  initialValue: string;
  /** Pre-select this much of the value, e.g. the stem of a filename. */
  selectLength?: number | undefined;
  confirmLabel: string;
  onConfirm: (value: string) => void;
  onCancel: () => void;
}

/** The one inline bar used for new files, new folders, renames and adding a root. */
export function NamePrompt({
  label,
  initialValue,
  selectLength,
  confirmLabel,
  onConfirm,
  onCancel,
}: NamePromptProps) {
  const [value, setValue] = useState(initialValue);
  const input = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    const field = input.current;
    if (!field) return;
    field.focus();
    // Renaming "notes.md" should select "notes", not the extension.
    field.setSelectionRange(0, selectLength ?? initialValue.length);
  }, [initialValue, selectLength]);

  return (
    <form
      className="flex shrink-0 flex-col gap-1 border-b border-[var(--app-border)] px-2 py-2"
      onSubmit={(event) => {
        event.preventDefault();
        const trimmed = value.trim();
        if (trimmed.length > 0) onConfirm(trimmed);
      }}
    >
      <label htmlFor="name-prompt" className="text-[11px] uppercase tracking-wider text-[var(--app-muted)]">
        {label}
      </label>
      <input
        id="name-prompt"
        ref={input}
        value={value}
        onChange={(event) => setValue(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            event.preventDefault();
            onCancel();
          }
        }}
        className="rounded border border-[var(--app-border)] bg-transparent px-2 py-1 text-sm outline-none focus:border-[var(--app-accent)]"
      />
      <span className="flex gap-1">
        <button
          type="submit"
          className="rounded border border-[var(--app-border)] px-2 py-0.5 text-xs hover:bg-[var(--app-hover)]"
        >
          {confirmLabel}
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="rounded px-2 py-0.5 text-xs text-[var(--app-muted)] hover:bg-[var(--app-hover)]"
        >
          Cancel
        </button>
      </span>
    </form>
  );
}
