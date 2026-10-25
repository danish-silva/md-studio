import type { ColumnAlignment, TableCommandName, TableStatus } from '@md-studio/editor';

export interface TableToolbarProps {
  status: TableStatus;
  onRun: (name: TableCommandName) => void;
  onAlign: (alignment: ColumnAlignment) => void;
}

interface ActionProps {
  name: TableCommandName;
  label: string;
  status: TableStatus;
  onRun: (name: TableCommandName) => void;
  reason?: string | undefined;
}

function Action({ name, label, status, onRun, reason }: ActionProps) {
  const enabled = status.can[name];
  return (
    <button
      type="button"
      title={enabled ? label : (reason ?? label)}
      disabled={!enabled}
      onClick={() => onRun(name)}
      className="rounded px-1.5 py-0.5 text-xs hover:bg-[var(--app-hover)] disabled:cursor-not-allowed disabled:opacity-30"
    >
      {label}
    </button>
  );
}

const ALIGNMENTS: { value: ColumnAlignment; label: string; title: string }[] = [
  { value: null, label: '—', title: 'No alignment marker' },
  { value: 'left', label: '⟨', title: 'Align column left (:---)' },
  { value: 'center', label: '≡', title: 'Centre column (:--:)' },
  { value: 'right', label: '⟩', title: 'Align column right (---:)' },
];

/**
 * Appears only while the caret is in a table.
 *
 * There is no header-row toggle: every GFM table has a header row, so the first row
 * always is one and cannot be removed.
 */
export function TableToolbar({ status, onRun, onAlign }: TableToolbarProps) {
  const headerReason = 'A GFM table always keeps its header row.';

  return (
    <div
      role="toolbar"
      aria-label="Table"
      className="flex shrink-0 flex-wrap items-center gap-2 border-b border-[var(--app-border)] bg-[var(--app-bg)] px-3 py-1 text-xs text-[var(--app-muted)]"
    >
      <span className="text-[11px] uppercase tracking-wider">
        Table · row {status.rowIndex + 1}/{status.rowCount} · column {status.columnIndex + 1}/
        {status.columnCount}
      </span>

      <span className="flex items-center gap-0.5">
        <Action name="addRowAbove" label="+ Row above" status={status} onRun={onRun} reason={headerReason} />
        <Action name="addRowBelow" label="+ Row below" status={status} onRun={onRun} />
        <Action
          name="deleteRow"
          label="− Row"
          status={status}
          onRun={onRun}
          reason={status.inHeaderRow ? headerReason : 'A table needs at least one row.'}
        />
      </span>

      <span className="flex items-center gap-0.5">
        <Action name="addColumnBefore" label="+ Col before" status={status} onRun={onRun} />
        <Action name="addColumnAfter" label="+ Col after" status={status} onRun={onRun} />
        <Action
          name="deleteColumn"
          label="− Col"
          status={status}
          onRun={onRun}
          reason="A table needs at least one column."
        />
      </span>

      <span className="flex items-center gap-0.5">
        <span className="mr-1">Align</span>
        {ALIGNMENTS.map((option) => (
          <button
            key={option.label}
            type="button"
            title={option.title}
            aria-pressed={status.alignment === option.value}
            onClick={() => onAlign(option.value)}
            className={[
              'h-6 w-6 rounded text-sm leading-none',
              status.alignment === option.value
                ? 'bg-[var(--app-accent-soft)] text-[var(--app-text)]'
                : 'hover:bg-[var(--app-hover)]',
            ].join(' ')}
          >
            {option.label}
          </button>
        ))}
      </span>

      <Action name="deleteTable" label="Delete table" status={status} onRun={onRun} />
    </div>
  );
}
