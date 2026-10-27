import { outlineOf, type OutlineEntry } from '@md-studio/markdown';
import { useMemo, useState } from 'react';
import { useDocuments } from '../state/documents';
import { useNavigate } from '../state/navigate';

/** Headings of the document on screen, clickable, and draggable to move whole sections. */
export function OutlinePanel() {
  const doc = useDocuments((state) =>
    state.activePath === null ? null : (state.byPath[state.activePath] ?? null),
  );
  const [dragOver, setDragOver] = useState<number | null>(null);

  const entries = useMemo<OutlineEntry[]>(
    () => (doc === null ? [] : outlineOf(doc.text)),
    [doc?.text],
  );

  if (doc === null) {
    return <p className="px-3 py-3 text-xs text-[var(--app-muted)]">No document open.</p>;
  }

  if (entries.length === 0) {
    return <p className="px-3 py-3 text-xs text-[var(--app-muted)]">This document has no headings.</p>;
  }

  return (
    <ul className="h-full overflow-y-auto py-1">
      {entries.map((entry) => (
        <li key={`${String(entry.index)}:${entry.text}`}>
          <button
            type="button"
            draggable
            title={`Heading ${String(entry.level)} · line ${String(entry.line)}`}
            onClick={() => useNavigate.getState().revealHeading(entry.index)}
            onDragStart={(event) => {
              event.dataTransfer.setData('text/md-studio-heading', String(entry.index));
              event.dataTransfer.effectAllowed = 'move';
            }}
            onDragOver={(event) => {
              if (!event.dataTransfer.types.includes('text/md-studio-heading')) return;
              event.preventDefault();
              event.dataTransfer.dropEffect = 'move';
              setDragOver(entry.index);
            }}
            onDragLeave={() => setDragOver((current) => (current === entry.index ? null : current))}
            onDrop={(event) => {
              event.preventDefault();
              setDragOver(null);
              const from = Number(event.dataTransfer.getData('text/md-studio-heading'));
              if (Number.isFinite(from)) useNavigate.getState().moveSection(from, entry.index);
            }}
            style={{ paddingLeft: `${String(8 + (entry.level - 1) * 12)}px` }}
            className={[
              'block w-full truncate py-1 pr-2 text-left text-[13px] hover:bg-[var(--app-hover)]',
              entry.level === 1 ? 'font-medium' : 'text-[var(--app-muted)]',
              dragOver === entry.index ? 'outline outline-1 outline-[var(--app-accent)]' : '',
            ].join(' ')}
          >
            {entry.text.length > 0 ? entry.text : '(untitled heading)'}
          </button>
        </li>
      ))}
    </ul>
  );
}
