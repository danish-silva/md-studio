import { useEffect, useRef } from 'react';
import { useFind } from '../state/find';

/** Find and replace for the document on screen. Ctrl+F opens it, Ctrl+H with replace. */
export function FindBar() {
  const state = useFind();
  const input = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    input.current?.focus();
    input.current?.select();
  }, [state.showReplace]);

  const status =
    state.error !== null
      ? state.error
      : state.query.length === 0
        ? ''
        : state.total === 0
          ? 'No results'
          : `${String(state.current + 1)} of ${String(state.total)}`;

  return (
    <div
      role="search"
      className="flex shrink-0 flex-wrap items-center gap-2 border-b border-[var(--app-border)] bg-[var(--app-panel)] px-3 py-1.5 text-xs"
    >
      <input
        ref={input}
        value={state.query}
        placeholder="Find"
        aria-label="Find"
        onChange={(event) => useFind.getState().setQuery(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            event.preventDefault();
            useFind.getState().ask(event.shiftKey ? 'previous' : 'next');
          } else if (event.key === 'Escape') {
            event.preventDefault();
            useFind.getState().close();
          }
        }}
        className="w-48 rounded border border-[var(--app-border)] bg-transparent px-2 py-0.5 outline-none focus:border-[var(--app-accent)]"
      />

      <Toggle
        label="Aa"
        title="Match case"
        active={state.caseSensitive}
        onToggle={() => useFind.getState().setCaseSensitive(!state.caseSensitive)}
      />
      <Toggle
        label=".*"
        title="Regular expression"
        active={state.regex}
        onToggle={() => useFind.getState().setRegex(!state.regex)}
      />

      <button
        type="button"
        title="Previous match (Shift+Enter)"
        onClick={() => useFind.getState().ask('previous')}
        className="rounded px-1.5 py-0.5 hover:bg-[var(--app-hover)]"
      >
        ↑
      </button>
      <button
        type="button"
        title="Next match (Enter)"
        onClick={() => useFind.getState().ask('next')}
        className="rounded px-1.5 py-0.5 hover:bg-[var(--app-hover)]"
      >
        ↓
      </button>

      <span
        className={[
          'min-w-24',
          state.error !== null ? 'text-red-300' : 'text-[var(--app-muted)]',
        ].join(' ')}
      >
        {status}
      </span>

      {state.showReplace && (
        <>
          <input
            value={state.replacement}
            placeholder={state.regex ? 'Replace ($1 for groups)' : 'Replace'}
            aria-label="Replace"
            onChange={(event) => useFind.getState().setReplacement(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Escape') useFind.getState().close();
            }}
            className="w-48 rounded border border-[var(--app-border)] bg-transparent px-2 py-0.5 outline-none focus:border-[var(--app-accent)]"
          />
          <button
            type="button"
            disabled={state.total === 0}
            onClick={() => useFind.getState().ask('replace')}
            className="rounded border border-[var(--app-border)] px-2 py-0.5 hover:bg-[var(--app-hover)] disabled:opacity-40"
          >
            Replace
          </button>
          <button
            type="button"
            disabled={state.total === 0}
            onClick={() => useFind.getState().ask('replaceAll')}
            className="rounded border border-[var(--app-border)] px-2 py-0.5 hover:bg-[var(--app-hover)] disabled:opacity-40"
          >
            All
          </button>
        </>
      )}

      <button
        type="button"
        title="Close (Escape)"
        onClick={() => useFind.getState().close()}
        className="ml-auto rounded px-1.5 py-0.5 text-[var(--app-muted)] hover:bg-[var(--app-hover)]"
      >
        ✕
      </button>
    </div>
  );
}

function Toggle({
  label,
  title,
  active,
  onToggle,
}: {
  label: string;
  title: string;
  active: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      title={title}
      aria-pressed={active}
      onClick={onToggle}
      className={[
        'rounded px-1.5 py-0.5 font-mono',
        active ? 'bg-[var(--app-accent-soft)] text-[var(--app-text)]' : 'hover:bg-[var(--app-hover)]',
      ].join(' ')}
    >
      {label}
    </button>
  );
}
