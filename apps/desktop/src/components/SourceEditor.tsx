import { useEffect, useRef } from 'react';
import { EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { markdown } from '@codemirror/lang-markdown';
import { oneDark } from '@codemirror/theme-one-dark';
import { basicSetup } from 'codemirror';
import { readCachedState, writeCachedState } from '../lib/editor-cache';
import { useDocuments } from '../state/documents';

const layout = EditorView.theme({
  '&': { height: '100%', fontSize: '14px' },
  '&.cm-focused': { outline: 'none' },
  '.cm-scroller': {
    fontFamily: 'ui-monospace, "Cascadia Code", "JetBrains Mono", Consolas, monospace',
    lineHeight: '1.7',
  },
  '.cm-content': { padding: '18px 22px 40vh' },
  '.cm-gutters': { border: 'none' },
});

export interface SourceEditorProps {
  /**
   * Identity of the buffer on screen: path plus load revision. Changing it mounts a fresh
   * editor, so undo history never leaks across files and a reload from disk cannot leave
   * the previous text on screen.
   */
  documentKey: string;
  documentPath: string;
  initialText: string;
  onChange: (text: string) => void;
}

export function SourceEditor({ documentKey, documentPath, initialText, onChange }: SourceEditorProps) {
  const host = useRef<HTMLDivElement | null>(null);
  // Held in a ref so a new callback identity does not tear down the editor.
  const notify = useRef(onChange);
  notify.current = onChange;

  useEffect(() => {
    const parent = host.current;
    if (!parent) return;

    // Reuse the state this tab had when it was last on screen, so switching away and
    // back does not reset undo history.
    const cached = readCachedState<EditorState>(documentKey, initialText);

    const view = new EditorView({
      parent,
      state:
        cached ??
        EditorState.create({
          doc: initialText,
          extensions: [
            basicSetup,
            markdown(),
            oneDark,
            layout,
            EditorView.lineWrapping,
            EditorView.updateListener.of((update) => {
              if (update.docChanged) {
                notify.current(update.state.doc.toString());
              }
            }),
          ],
        }),
    });
    const remembered = useDocuments.getState().byPath[documentPath];
    if (!cached && remembered && remembered.cursor > 0) {
      const at = Math.min(remembered.cursor, view.state.doc.length);
      view.dispatch({ selection: { anchor: at } });
      requestAnimationFrame(() => {
        view.scrollDOM.scrollTop = remembered.scrollTop;
      });
    }
    view.focus();

    return () => {
      useDocuments.getState().recordViewState(documentPath, {
        cursor: view.state.selection.main.head,
        scrollTop: view.scrollDOM.scrollTop,
      });
      writeCachedState(documentKey, view.state, view.state.doc.toString());
      view.destroy();
    };
    // initialText is the seed for this mount only; later edits flow through onChange.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [documentKey, documentPath]);

  return <div ref={host} className="h-full overflow-hidden" />;
}
