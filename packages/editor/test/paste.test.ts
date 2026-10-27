import { docToMarkdown, schema } from '@md-studio/markdown';
import { describe, expect, it } from 'vitest';
import { parseDelimited, tableFromRows } from '../src/index.ts';

function asMarkdown(rows: string[][]): string {
  return docToMarkdown(schema.nodes['doc']!.create(null, [tableFromRows(rows)]));
}

describe('delimited text', () => {
  it('reads tab separated rows', () => {
    expect(parseDelimited('a\tb\nc\td\n')).toEqual([
      ['a', 'b'],
      ['c', 'd'],
    ]);
  });

  it('reads comma separated rows', () => {
    expect(parseDelimited('a,b\nc,d')).toEqual([
      ['a', 'b'],
      ['c', 'd'],
    ]);
  });

  it('leaves quoted CSV alone, because guessing would mangle it', () => {
    expect(parseDelimited('a,"b,c"\nd,"e,f"')).toBeNull();
  });

  it('ignores a single line, a single column and ragged rows', () => {
    expect(parseDelimited('a\tb')).toBeNull();
    expect(parseDelimited('one\ntwo')).toBeNull();
    expect(parseDelimited('a\tb\nc\td\te')).toBeNull();
  });

  it('prefers tabs when both separators are present', () => {
    expect(parseDelimited('a,1\tb,2\nc,3\td,4')).toEqual([
      ['a,1', 'b,2'],
      ['c,3', 'd,4'],
    ]);
  });

  it('builds a table whose first row is the header', () => {
    expect(asMarkdown([
      ['Name', 'Role'],
      ['Ada', 'Engineer'],
    ])).toBe('| Name | Role     |\n| ---- | -------- |\n| Ada  | Engineer |\n');
  });
});
