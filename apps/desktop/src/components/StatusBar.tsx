import { countWords, detectLineEnding } from '../lib/text';
import type { OpenDocument } from '../state/documents';

export interface StatusBarProps {
  doc: OpenDocument | null;
  providerId: string;
  busy: boolean;
}

export function StatusBar({ doc, providerId, busy }: StatusBarProps) {
  return (
    <footer className="flex shrink-0 items-center gap-4 border-t border-[var(--app-border)] bg-[var(--app-panel)] px-4 py-1 text-xs text-[var(--app-muted)]">
      <span>{busy ? 'Working…' : 'Ready'}</span>
      {doc && (
        <>
          <span>{countWords(doc.text).toLocaleString()} words</span>
          <span>{doc.text.length.toLocaleString()} chars</span>
          <span>{detectLineEnding(doc.text)}</span>
          <span>{doc.dirty ? 'Unsaved changes' : 'Saved'}</span>
        </>
      )}
      <span className="ml-auto" title="Filesystem provider in use">
        fs: {providerId}
      </span>
    </footer>
  );
}
