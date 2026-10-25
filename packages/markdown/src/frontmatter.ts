import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';

export type FieldValue = string | number | boolean | string[];

export interface Frontmatter {
  present: boolean;
  /**
   * Null when the YAML is nested, or does not parse. The form cannot represent those
   * without quietly flattening something, so it declines and points at source mode.
   */
  fields: Record<string, FieldValue> | null;
  raw: string;
  /** Why `fields` is null, for the UI to show. */
  reason: string | null;
}

const FENCE = /^---\r?\n([\s\S]*?)\r?\n---(\r?\n|$)/;

export function readFrontmatter(source: string): Frontmatter {
  const match = FENCE.exec(source);
  if (!match) {
    return { present: false, fields: {}, raw: '', reason: null };
  }

  const raw = match[1] ?? '';
  let parsed: unknown;
  try {
    parsed = parseYaml(raw);
  } catch (error) {
    return {
      present: true,
      fields: null,
      raw,
      reason: error instanceof Error ? error.message.split('\n')[0] ?? 'Invalid YAML' : 'Invalid YAML',
    };
  }

  if (parsed === null || parsed === undefined) {
    return { present: true, fields: {}, raw, reason: null };
  }
  if (typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { present: true, fields: null, raw, reason: 'Frontmatter is not a set of fields.' };
  }

  const fields: Record<string, FieldValue> = {};
  for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
    const field = toField(value);
    if (field === null) {
      return {
        present: true,
        fields: null,
        raw,
        reason: `"${key}" is nested, which this form cannot edit.`,
      };
    }
    fields[key] = field;
  }

  return { present: true, fields, raw, reason: null };
}

function toField(value: unknown): FieldValue | null {
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return value;
  }
  if (Array.isArray(value) && value.every((entry) => typeof entry === 'string')) {
    return value as string[];
  }
  return null;
}

/**
 * Writes the fields back, leaving the body untouched. Removing every field removes the
 * block rather than leaving an empty fence behind.
 */
export function writeFrontmatter(source: string, fields: Record<string, FieldValue>): string {
  const match = FENCE.exec(source);
  const body = match ? source.slice(match[0].length) : source;

  if (Object.keys(fields).length === 0) {
    return body.replace(/^\r?\n+/, '');
  }

  const yaml = stringifyYaml(fields).trimEnd();
  const separator = body.startsWith('\n') ? '' : '\n';
  return `---\n${yaml}\n---\n${separator}${body}`;
}
