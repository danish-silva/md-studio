import { basename } from '../lib/text';
import { useDocuments, type PaneId } from '../state/documents';
import { useSettings } from '../state/settings';
import { ConflictBar } from './ConflictBar';
import { MissingFileBar } from './MissingFileBar';
import { SourceEditor } from './SourceEditor';
import { WysiwygPane } from './WysiwygPane';

export interface EditorPaneProps {
  pane: PaneId;
  /** Shown only when the editor is split, so a single pane stays uncluttered. */
  showPaneControls: boolean;
}

export function EditorPane({ pane, showPaneControls }: EditorPaneProps) {
  const path = useDocuments((state) =>
    pane === 'primary' ? state.activePath : state.secondaryPath,
  );
  const doc = useDocuments((state) => (path === null ? null : (state.byPath[path] ?? null)));
  const focused = useDocuments((state) => state.focusedPane === pane);

  const focusMode = useSettings((state) => state.focusMode);
  const renderDiagrams = useSettings((state) => state.renderDiagrams);
  const renderMath = useSettings((state) => state.renderMath);
  const theme = useSettings((state) => state.theme);

  if (doc === null || path === null) {
    return (
      <section className="flex min-w-0 flex-1 flex-col">
        <p className="p-8 text-sm text-[var(--app-muted)]">
          Pick a markdown file from the explorer to start editing.
        </p>
      </section>
    );
  }

  // Rendering options change how the document is drawn, so the editor is rebuilt when
  // they do. Theme is in here because CodeMirror's colour scheme is baked into its state.
  const renderKey = `${theme}:${String(renderDiagrams)}:${String(renderMath)}`;

  return (
    <section
      onFocusCapture={() => useDocuments.getState().focusPane(pane)}
      className={[
        'flex min-w-0 flex-1 flex-col',
        showPaneControls && focused ? 'ring-1 ring-inset ring-[var(--app-accent)]/40' : '',
      ].join(' ')}
    >
      <header className="flex shrink-0 items-center gap-2 border-b border-[var(--app-border)] px-3 py-1.5">
        <h2 className="truncate text-sm font-medium" title={doc.path}>
          {basename(doc.path)}
        </h2>
        {doc.dirty && (
          <span aria-label="Unsaved changes" className="size-1.5 rounded-full bg-[var(--app-accent)]" />
        )}

        <button
          type="button"
          onClick={() => useDocuments.getState().setMode(path, doc.mode === 'wysiwyg' ? 'source' : 'wysiwyg')}
          title="Toggle source mode (Ctrl+Shift+M)"
          className="ml-auto rounded border border-[var(--app-border)] px-2 py-0.5 text-xs text-[var(--app-muted)] hover:bg-[var(--app-hover)]"
        >
          {doc.mode === 'source' ? 'Markdown source' : 'Formatted'}
        </button>

        {showPaneControls && pane === 'secondary' && (
          <button
            type="button"
            title="Close the split"
            onClick={() => useDocuments.getState().closeSplit()}
            className="rounded px-1.5 py-0.5 text-xs text-[var(--app-muted)] hover:bg-[var(--app-hover)]"
          >
            ✕
          </button>
        )}
      </header>

      {doc.missing && (
        <MissingFileBar
          name={basename(doc.path)}
          dirty={doc.dirty}
          onRecreate={() => void useDocuments.getState().save(path, { force: true })}
          onClose={() => useDocuments.getState().requestClose(path)}
        />
      )}

      {doc.conflict != null && (
        <ConflictBar
          conflict={doc.conflict}
          onReload={() => void useDocuments.getState().reloadFromDisk(path)}
          onOverwrite={() => void useDocuments.getState().save(path, { force: true })}
        />
      )}

      <div className={['min-h-0 flex-1', focusMode ? 'md-focus' : ''].join(' ')}>
        {doc.mode === 'wysiwyg' ? (
          <WysiwygPane
            documentKey={`${doc.path}::${String(doc.revision)}::wysiwyg::${pane}::${renderKey}`}
            documentPath={doc.path}
            initialMarkdown={doc.text}
            onChange={(text) => useDocuments.getState().setText(doc.path, text)}
          />
        ) : (
          <SourceEditor
            documentKey={`${doc.path}::${String(doc.revision)}::source::${pane}::${renderKey}`}
            documentPath={doc.path}
            initialText={doc.text}
            onChange={(text) => useDocuments.getState().setText(doc.path, text)}
          />
        )}
      </div>
    </section>
  );
}
