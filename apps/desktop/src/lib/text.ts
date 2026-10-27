/**
 * Status-bar counters.
 *
 * These are deliberately naive: they count the markdown source, syntax included. P1
 * replaces them with mdast-aware counts that ignore fences, link targets and frontmatter.
 */

export function countWords(text: string): number {
  return text.match(/[\p{L}\p{N}'’_-]+/gu)?.length ?? 0;
}

export type LineEnding = 'LF' | 'CRLF' | 'mixed' | 'none';

export function detectLineEnding(text: string): LineEnding {
  const crlf = text.match(/\r\n/g)?.length ?? 0;
  const loneLf = text.match(/(?<!\r)\n/g)?.length ?? 0;

  if (crlf > 0 && loneLf > 0) return 'mixed';
  if (crlf > 0) return 'CRLF';
  if (loneLf > 0) return 'LF';
  return 'none';
}

export function isMarkdownPath(filePath: string): boolean {
  return /\.(md|markdown)$/i.test(filePath);
}

export function basename(filePath: string): string {
  const segments = filePath.split(/[\\/]/).filter((segment) => segment.length > 0);
  return segments[segments.length - 1] ?? filePath;
}

/** Keeps whichever separator the host already uses, so paths stay round-trippable. */
export function joinPath(dir: string, name: string): string {
  const separator = dir.includes('\\') ? '\\' : '/';
  return `${dir.replace(/[\\/]+$/, '')}${separator}${name}`;
}

/** Windows paths differ in case and separator without pointing anywhere different. */
export function samePath(left: string, right: string): boolean {
  const normalise = (value: string) => value.replace(/[\\/]+/g, '/').replace(/\/$/, '').toLowerCase();
  return normalise(left) === normalise(right);
}

export function isInside(parent: string, candidate: string): boolean {
  const normalise = (value: string) => value.replace(/[\\/]+/g, '/').replace(/\/$/, '').toLowerCase();
  return `${normalise(candidate)}/`.startsWith(`${normalise(parent)}/`);
}

export function parentDir(dirPath: string): string | null {
  const match = /^(.*[\\/])[^\\/]+[\\/]?$/.exec(dirPath);
  if (!match) return null;
  const parent = match[1];
  if (parent === undefined) return null;
  const trimmed = parent.replace(/[\\/]+$/, '');
  // Keep the trailing separator on a drive or filesystem root.
  const normalised = trimmed.length === 0 || /^[A-Za-z]:$/.test(trimmed) ? `${trimmed}/` : trimmed;
  return normalised === dirPath ? null : normalised;
}

/**
 * Resolves a relative markdown link against the folder holding the document.
 *
 * Anchors and query strings are dropped, percent-escapes are decoded, and anything that
 * climbs above the folder root returns null rather than a nonsense path.
 */
export function resolveRelative(dir: string, url: string): string | null {
  const target = url.split('#')[0]?.split('?')[0] ?? '';
  if (target.length === 0) return null;

  let decoded: string;
  try {
    decoded = decodeURIComponent(target);
  } catch {
    decoded = target;
  }

  const separator = dir.includes('\\') ? '\\' : '/';
  const base = dir.replace(/[\\/]+$/, '').split(/[\\/]/);

  for (const segment of decoded.split('/')) {
    if (segment === '' || segment === '.') continue;
    if (segment === '..') {
      if (base.length <= 1) return null;
      base.pop();
      continue;
    }
    base.push(segment);
  }

  return base.join(separator);
}
