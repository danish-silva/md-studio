import { htmlToMarkdown, markdownToDoc } from '@md-studio/markdown';
import { Slice, type Node as PmNode } from 'prosemirror-model';
import { Plugin, TextSelection } from 'prosemirror-state';
import type { EditorView } from 'prosemirror-view';
import { nodes, schema } from './schema-types.ts';
import { findTableContext } from './tables.ts';

export interface PasteOptions {
  /**
   * Image files from a paste or a drop. Where they are written is the app's business —
   * this package has no filesystem.
   */
  onImageFiles?: ((files: File[], view: EditorView) => void) | undefined;
}

/**
 * Everything arriving from outside the editor is funnelled through markdown first.
 *
 * Word and web HTML is converted rather than parsed directly, so the mess of spans, font
 * tags and mso-* styles cannot smuggle structure into the document that the file format
 * has no way to store.
 */
export function pastePlugin(options: PasteOptions = {}): Plugin {
  return new Plugin({
    props: {
      handlePaste(view, event) {
        const clipboard = event.clipboardData;
        if (!clipboard) return false;

        const images = imageFilesOf(clipboard.files);
        if (images.length > 0 && options.onImageFiles) {
          event.preventDefault();
          options.onImageFiles(images, view);
          return true;
        }

        // A code block takes bytes as they come.
        if (view.state.selection.$from.parent.type.spec.code === true) return false;

        const html = clipboard.getData('text/html');
        // ProseMirror tags its own clipboard HTML; that path already round-trips exactly.
        if (html.length > 0 && !html.includes('data-pm-slice')) {
          insertMarkdown(view, htmlToMarkdown(html));
          return true;
        }

        const text = clipboard.getData('text/plain');
        if (text.length > 0 && findTableContext(view.state) === null) {
          const rows = parseDelimited(text);
          if (rows) {
            view.dispatch(view.state.tr.replaceSelectionWith(tableFromRows(rows)).scrollIntoView());
            return true;
          }
        }

        return false;
      },

      handleDrop(view, event, _slice, moved) {
        if (moved) return false;

        const files = imageFilesOf(event.dataTransfer?.files);
        if (files.length === 0 || !options.onImageFiles) return false;

        event.preventDefault();
        // Drop where the pointer is, not where the caret happened to be.
        const at = view.posAtCoords({ left: event.clientX, top: event.clientY });
        if (at) {
          view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, at.pos)));
        }
        options.onImageFiles(files, view);
        return true;
      },
    },
  });
}

function imageFilesOf(list: FileList | null | undefined): File[] {
  return Array.from(list ?? []).filter((file) => file.type.startsWith('image/'));
}

function insertMarkdown(view: EditorView, markdown: string): void {
  const doc = markdownToDoc(markdown);
  if (doc.content.size === 0) return;

  // A single paragraph merges into the text around the caret; anything with real block
  // structure is inserted as blocks.
  const inline = doc.childCount === 1 && doc.firstChild?.isTextblock === true;
  const slice = new Slice(doc.content, inline ? 1 : 0, inline ? 1 : 0);
  view.dispatch(view.state.tr.replaceSelection(slice).scrollIntoView());
}

/**
 * Spreadsheet cells arrive as tab-separated text. Commas are accepted too, but only when
 * nothing is quoted — quoted CSV needs a real parser, and guessing wrong would mangle the
 * paste silently.
 */
export function parseDelimited(text: string): string[][] | null {
  const lines = text.replace(/\r\n?/g, '\n').replace(/\n+$/, '').split('\n');
  if (lines.length < 2) return null;

  for (const delimiter of ['\t', ','] as const) {
    if (delimiter === ',' && text.includes('"')) continue;

    const rows = lines.map((line) => line.split(delimiter));
    const width = rows[0]?.length ?? 0;
    if (width < 2) continue;
    if (rows.every((row) => row.length === width)) return rows;
  }
  return null;
}

export function tableFromRows(rows: readonly string[][]): PmNode {
  const columns = rows[0]?.length ?? 0;

  const body = rows.map((row, rowIndex) =>
    nodes.tableRow.create(
      null,
      Array.from({ length: columns }, (_unused, column) => {
        const type = rowIndex === 0 ? nodes.tableHeader : nodes.tableCell;
        const value = row[column] ?? '';
        return type.create(null, value.length > 0 ? schema.text(value) : null);
      }),
    ),
  );

  return nodes.table.create({ align: Array.from({ length: columns }, () => null) }, body);
}
