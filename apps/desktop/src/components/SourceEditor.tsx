import { useEffect, useRef } from 'react';
import { EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { markdown } from '@codemirror/lang-markdown';
import { oneDark } from '@codemirror/theme-one-dark';
import { basicSetup } from 'codemirror';

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
  initialText: string;
  onChange: (text: string) => void;
}

export function SourceEditor({ documentKey, initialText, onChange }: SourceEditorProps) {
  const host = useRef<HTMLDivElement | null>(null);
  // Held in a ref so a new callback identity does not tear down the editor.
  const notify = useRef(onChange);
  notify.current = onChange;

  useEffect(() => {
    const parent = host.current;
    if (!parent) return;

    const view = new EditorView({
      parent,
      state: EditorState.create({
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
    view.focus();

    return () => view.destroy();
    // initialText is the seed for this mount only; later edits flow through onChange.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [documentKey]);

  return <div ref={host} className="h-full overflow-hidden" />;
}
