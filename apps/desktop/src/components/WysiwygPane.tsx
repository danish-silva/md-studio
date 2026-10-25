import { commands, createEditorState, readStatus, setLink, type CommandName, type EditorStatus } from '@md-studio/editor';
import { docToMarkdown } from '@md-studio/markdown';
import type { Command } from 'prosemirror-state';
import { EditorView } from 'prosemirror-view';
import { useCallback, useEffect, useRef, useState } from 'react';
import { LinkBar } from './LinkBar';
import { TaskItemView } from './TaskItemView';
import { Toolbar } from './Toolbar';

export interface WysiwygPaneProps {
  /** Path plus load revision: changing it mounts a fresh editor and a fresh history. */
  documentKey: string;
  initialMarkdown: string;
  onChange: (markdown: string) => void;
}

export function WysiwygPane({ documentKey, initialMarkdown, onChange }: WysiwygPaneProps) {
  const host = useRef<HTMLDivElement | null>(null);
  const view = useRef<EditorView | null>(null);
  const notify = useRef(onChange);
  notify.current = onChange;

  const [status, setStatus] = useState<EditorStatus | null>(null);
  const [linkDraft, setLinkDraft] = useState<string | null>(null);

  const openLinkBar = useCallback(() => {
    const current = view.current;
    if (!current) return;
    setLinkDraft(readStatus(current.state).link?.href ?? '');
  }, []);

  useEffect(() => {
    const parent = host.current;
    if (!parent) return;

    const editor = new EditorView(parent, {
      state: createEditorState(initialMarkdown, { onRequestLink: openLinkBar }),
      nodeViews: {
        listItem: (node, editorView, getPos) => new TaskItemView(node, editorView, getPos),
      },
      dispatchTransaction(transaction) {
        const next = editor.state.apply(transaction);
        editor.updateState(next);
        setStatus(readStatus(next));
        if (transaction.docChanged) {
          // The store keeps markdown, not a document, so the file on disk is never a
          // serialisation of something the user cannot see.
          notify.current(docToMarkdown(next.doc));
        }
      },
    });

    view.current = editor;
    setStatus(readStatus(editor.state));
    editor.focus();

    return () => {
      editor.destroy();
      view.current = null;
      setStatus(null);
      setLinkDraft(null);
    };
    // initialMarkdown seeds this mount only; later edits flow outwards through onChange.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [documentKey, openLinkBar]);

  const dispatch = useCallback((command: Command) => {
    const editor = view.current;
    if (!editor) return;
    command(editor.state, editor.dispatch, editor);
    editor.focus();
  }, []);

  const runNamed = useCallback(
    (name: CommandName) => {
      dispatch(commands[name]);
    },
    [dispatch],
  );

  const applyLink = useCallback(
    (href: string) => {
      setLinkDraft(null);
      const trimmed = href.trim();
      dispatch(trimmed.length > 0 ? setLink(trimmed) : commands.removeLink);
    },
    [dispatch],
  );

  return (
    <div className="flex h-full min-h-0 flex-col">
      <Toolbar status={status} onRun={runNamed} onLink={openLinkBar} />

      {linkDraft !== null && (
        <LinkBar
          initialHref={linkDraft}
          onApply={applyLink}
          onCancel={() => {
            setLinkDraft(null);
            view.current?.focus();
          }}
        />
      )}

      <div ref={host} className="md-editor-host min-h-0 flex-1 overflow-y-auto" />
    </div>
  );
}
