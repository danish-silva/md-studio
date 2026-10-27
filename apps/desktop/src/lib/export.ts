import { markdownToDocx, markdownToHtml } from '@md-studio/markdown';
import { fsProvider } from '../fs';
import { basename } from './text';

export type ExportFormat = 'html' | 'docx';

const MIME: Record<ExportFormat, string> = {
  html: 'text/html;charset=utf-8',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
};

const FILTER: Record<ExportFormat, string> = {
  html: 'Web page',
  docx: 'Word document',
};

/**
 * Writes the document out in another format.
 *
 * The desktop app asks where with a native dialog and writes the bytes; the browser has
 * no such thing, so it hands the file to the download machinery instead. Returns where it
 * went, or null if the user backed out.
 */
export async function exportDocument(
  format: ExportFormat,
  path: string,
  text: string,
): Promise<string | null> {
  const stem = basename(path).replace(/\.(md|markdown)$/i, '');
  const name = `${stem}.${format}`;
  const title = stem;

  const bytes =
    format === 'html'
      ? new TextEncoder().encode(markdownToHtml(text, { title }))
      : await markdownToDocx(text, { title });

  const dialog = fsProvider.saveDialog?.bind(fsProvider);
  const write = fsProvider.writeBinary?.bind(fsProvider);

  if (dialog && write) {
    const target = await dialog({ defaultName: name, filterName: FILTER[format], extensions: [format] });
    if (target === null) return null;
    await write(target, bytes);
    return target;
  }

  download(name, bytes, MIME[format]);
  return name;
}

function download(name: string, bytes: Uint8Array, type: string): void {
  const blob = new Blob([bytes as BlobPart], { type });
  const url = URL.createObjectURL(blob);

  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  link.click();

  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/**
 * PDF goes through the print dialog rather than a PDF library.
 *
 * The webview already knows how to paginate HTML, and "Save as PDF" is a destination in
 * every print dialog, so this reuses the export stylesheet instead of maintaining a
 * second layout engine. A hidden iframe avoids the popup blocking a new window would hit.
 */
export function printDocument(path: string, text: string): void {
  const title = basename(path).replace(/\.(md|markdown)$/i, '');
  const html = markdownToHtml(text, { title });

  const frame = document.createElement('iframe');
  frame.setAttribute('aria-hidden', 'true');
  frame.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0;';
  document.body.append(frame);

  const inner = frame.contentDocument;
  if (!inner) {
    frame.remove();
    throw new Error('Could not open a print view');
  }

  inner.open();
  inner.write(html);
  inner.close();

  // The written document needs a moment to lay out before it can be printed.
  setTimeout(() => {
    frame.contentWindow?.focus();
    frame.contentWindow?.print();
    setTimeout(() => frame.remove(), 60_000);
  }, 200);
}
