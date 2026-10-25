import { documentStats, type DocumentStats } from '@md-studio/markdown';
import { useEffect, useState } from 'react';
import { detectLineEnding } from '../lib/text';
import type { OpenDocument } from '../state/documents';
import { useLayout } from '../state/layout';

export interface StatusBarProps {
  doc: OpenDocument | null;
  providerId: string;
  busy: boolean;
}

const EMPTY: DocumentStats = { words: 0, characters: 0, readingMinutes: 0 };

export function StatusBar({ doc, providerId, busy }: StatusBarProps) {
  const [stats, setStats] = useState<DocumentStats>(EMPTY);

  // Counting means parsing, so it waits for a pause rather than running per keystroke.
  useEffect(() => {
    if (doc === null) {
      setStats(EMPTY);
      return;
    }
    const timer = setTimeout(() => setStats(documentStats(doc.text)), 300);
    return () => clearTimeout(timer);
  }, [doc?.text, doc]);

  return (
    <footer className="flex shrink-0 items-center gap-4 border-t border-[var(--app-border)] bg-[var(--app-panel)] px-4 py-1 text-xs text-[var(--app-muted)]">
      <span>{busy ? 'Working…' : 'Ready'}</span>

      {doc && (
        <>
          <span>{stats.words.toLocaleString()} words</span>
          <span title="At 200 words a minute">{stats.readingMinutes} min read</span>
          <span>{detectLineEnding(doc.text)}</span>
          <span>{doc.dirty ? 'Unsaved changes' : 'Saved'}</span>
        </>
      )}

      <button
        type="button"
        onClick={() => useLayout.getState().setSettingsOpen(true)}
        title="Settings (Ctrl+,)"
        className="ml-auto rounded px-1.5 hover:bg-[var(--app-hover)]"
      >
        Settings
      </button>
      <span title="Filesystem provider in use">fs: {providerId}</span>
    </footer>
  );
}
