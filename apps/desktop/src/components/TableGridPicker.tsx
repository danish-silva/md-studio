import { useEffect, useRef, useState } from 'react';

const MAX_ROWS = 8;
const MAX_COLUMNS = 8;

export interface TableGridPickerProps {
  disabled: boolean;
  reason?: string | undefined;
  onInsert: (rows: number, columns: number) => void;
}

/** Word's grid picker: drag across the squares, release, get that many rows and columns. */
export function TableGridPicker({ disabled, reason, onInsert }: TableGridPickerProps) {
  const [open, setOpen] = useState(false);
  const [hover, setHover] = useState({ rows: 1, columns: 1 });
  const container = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;

    function onPointerDown(event: MouseEvent) {
      if (!container.current?.contains(event.target as Node)) setOpen(false);
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') setOpen(false);
    }

    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  return (
    <div ref={container} className="relative">
      <button
        type="button"
        aria-label="Insert table"
        aria-expanded={open}
        title={reason ?? 'Insert table'}
        disabled={disabled}
        onClick={() => setOpen((value) => !value)}
        className={[
          'flex h-7 min-w-7 items-center justify-center rounded px-1.5 text-sm leading-none',
          'disabled:cursor-not-allowed disabled:opacity-30',
          open ? 'bg-[var(--app-accent-soft)]' : 'hover:bg-[var(--app-hover)]',
        ].join(' ')}
      >
        ⊞
      </button>

      {open && (
        <div className="absolute left-0 top-8 z-20 rounded border border-[var(--app-border)] bg-[var(--app-panel)] p-2 shadow-lg">
          <div
            className="grid gap-0.5"
            style={{ gridTemplateColumns: `repeat(${String(MAX_COLUMNS)}, 1rem)` }}
            onMouseLeave={() => setHover({ rows: 1, columns: 1 })}
          >
            {Array.from({ length: MAX_ROWS * MAX_COLUMNS }, (_unused, index) => {
              const row = Math.floor(index / MAX_COLUMNS) + 1;
              const column = (index % MAX_COLUMNS) + 1;
              const active = row <= hover.rows && column <= hover.columns;

              return (
                <button
                  key={index}
                  type="button"
                  aria-label={`${String(row)} by ${String(column)}`}
                  onMouseEnter={() => setHover({ rows: row, columns: column })}
                  onClick={() => {
                    setOpen(false);
                    onInsert(row, column);
                  }}
                  className={[
                    'h-4 w-4 rounded-[2px] border',
                    active
                      ? 'border-[var(--app-accent)] bg-[var(--app-accent-soft)]'
                      : 'border-[var(--app-border)]',
                  ].join(' ')}
                />
              );
            })}
          </div>
          <p className="mt-2 text-center text-[11px] text-[var(--app-muted)]">
            {hover.rows} × {hover.columns}
            <span className="ml-1 opacity-70">(first row is the header)</span>
          </p>
        </div>
      )}
    </div>
  );
}
