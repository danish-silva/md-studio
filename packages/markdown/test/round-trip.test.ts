/**
 * The golden corpus.
 *
 * Two groups, because they assert different things:
 *
 * - `fixtures/canonical` is already in the style the serializer emits, so parsing and
 *   writing it back must be byte-identical. Any drift here means the editor would rewrite
 *   parts of a file the user never touched.
 * - `fixtures/normalize` pairs messy input with the exact output we commit to producing.
 *   These files document, rather than hide, the changes a save does make.
 *
 * Every fixture is run twice: through the pipeline alone, and through the ProseMirror
 * bridge. When only the second fails, the bridge lost something the pipeline kept.
 */
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { docToMarkdown, markdownToDoc, normalizeMarkdown } from '../src/index.ts';

const fixtures = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures');

function read(...segments: string[]): string {
  return readFileSync(path.join(...segments), 'utf8');
}

function listFixtures(dir: string, suffix: string): string[] {
  const names = readdirSync(path.join(fixtures, dir)).filter((name) => name.endsWith(suffix));
  if (names.length === 0) {
    throw new Error(`No "${suffix}" fixtures in ${dir}`);
  }
  return names;
}

function throughBridge(source: string): string {
  return docToMarkdown(markdownToDoc(source));
}

describe('canonical fixtures', () => {
  const names = listFixtures('canonical', '.md');

  it.each(names)('%s is unchanged by parse and stringify', (name) => {
    const source = read(fixtures, 'canonical', name);
    expect(normalizeMarkdown(source)).toBe(source);
  });

  it.each(names)('%s is unchanged by the ProseMirror round trip', (name) => {
    const source = read(fixtures, 'canonical', name);
    expect(throughBridge(source)).toBe(source);
  });
});

describe('normalisation', () => {
  const names = listFixtures('normalize', '.in.md');

  it.each(names)('%s is rewritten to its committed canonical form', (name) => {
    const input = read(fixtures, 'normalize', name);
    const expected = read(fixtures, 'normalize', name.replace(/\.in\.md$/, '.out.md'));

    expect(normalizeMarkdown(input)).toBe(expected);
    expect(throughBridge(input)).toBe(expected);
  });

  it.each(names)('%s reaches a fixed point after one pass', (name) => {
    const expected = read(fixtures, 'normalize', name.replace(/\.in\.md$/, '.out.md'));

    // Saving twice must not keep changing the file.
    expect(normalizeMarkdown(expected)).toBe(expected);
    expect(throughBridge(expected)).toBe(expected);
  });
});
