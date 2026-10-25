import { useEffect, useRef, useState } from 'react';

export interface LinkBarProps {
  initialHref: string;
  onApply: (href: string) => void;
  onCancel: () => void;
}

/** Ctrl+K and the Link button both land here: the one thing the editor cannot invent. */
export function LinkBar({ initialHref, onApply, onCancel }: LinkBarProps) {
  const [href, setHref] = useState(initialHref);
  const input = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    input.current?.select();
  }, []);

  return (
    <form
      className="flex shrink-0 items-center gap-2 border-b border-[var(--app-border)] bg-[var(--app-panel)] px-3 py-1.5"
      onSubmit={(event) => {
        event.preventDefault();
        onApply(href);
      }}
    >
      <label htmlFor="link-href" className="text-xs text-[var(--app-muted)]">
        Link to
      </label>
      <input
        id="link-href"
        ref={input}
        value={href}
        placeholder="https://"
        onChange={(event) => setHref(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            event.preventDefault();
            onCancel();
          }
        }}
        className="min-w-0 flex-1 rounded border border-[var(--app-border)] bg-transparent px-2 py-0.5 text-sm outline-none focus:border-[var(--app-accent)]"
      />
      <button type="submit" className="rounded border border-[var(--app-border)] px-2 py-0.5 text-xs hover:bg-[var(--app-hover)]">
        Apply
      </button>
      <button
        type="button"
        onClick={onCancel}
        className="rounded px-2 py-0.5 text-xs text-[var(--app-muted)] hover:bg-[var(--app-hover)]"
      >
        Cancel
      </button>
    </form>
  );
}
