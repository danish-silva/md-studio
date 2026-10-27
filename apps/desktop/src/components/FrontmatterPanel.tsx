import { readFrontmatter, type FieldValue } from '@md-studio/markdown';
import { useEffect, useMemo, useState } from 'react';
import { stringify as stringifyYaml } from 'yaml';
import { useDocuments } from '../state/documents';
import { useNavigate } from '../state/navigate';

/**
 * Frontmatter as a form.
 *
 * Changes go back through the document as a transaction rather than rewriting the file,
 * so typing here does not reload the editor and the edit can be undone like any other.
 */
export function FrontmatterPanel() {
  const doc = useDocuments((state) =>
    state.activePath === null ? null : (state.byPath[state.activePath] ?? null),
  );

  const parsed = useMemo(() => (doc === null ? null : readFrontmatter(doc.text)), [doc?.text]);
  const [draft, setDraft] = useState<Record<string, FieldValue>>({});
  const [newKey, setNewKey] = useState('');

  // The document is the source of truth; the form follows it.
  useEffect(() => {
    if (parsed?.fields) setDraft(parsed.fields);
  }, [parsed?.fields]);

  if (doc === null) {
    return <p className="px-3 py-3 text-xs text-[var(--app-muted)]">No document open.</p>;
  }

  if (parsed !== null && parsed.fields === null) {
    return (
      <div className="px-3 py-3 text-xs text-[var(--app-muted)]">
        <p>{parsed.reason}</p>
        <p className="mt-2">Edit it in markdown source view (Ctrl+Shift+M).</p>
      </div>
    );
  }

  const commit = (fields: Record<string, FieldValue>) => {
    setDraft(fields);
    const yaml = Object.keys(fields).length === 0 ? '' : stringifyYaml(fields).trimEnd();
    useNavigate.getState().setFrontmatter(yaml);
  };

  const entries = Object.entries(draft);

  return (
    <div className="h-full space-y-2 overflow-y-auto p-2 text-xs">
      {entries.length === 0 && (
        <p className="text-[var(--app-muted)]">This document has no frontmatter yet.</p>
      )}

      {entries.map(([key, value]) => (
        <div key={key} className="space-y-1">
          <div className="flex items-center gap-1">
            <label htmlFor={`fm-${key}`} className="flex-1 truncate font-medium">
              {key}
            </label>
            <button
              type="button"
              title={`Remove ${key}`}
              onClick={() => {
                const next = { ...draft };
                delete next[key];
                commit(next);
              }}
              className="rounded px-1 text-[var(--app-muted)] hover:bg-[var(--app-hover)]"
            >
              ✕
            </button>
          </div>

          {typeof value === 'boolean' ? (
            <input
              id={`fm-${key}`}
              type="checkbox"
              checked={value}
              onChange={(event) => commit({ ...draft, [key]: event.target.checked })}
            />
          ) : Array.isArray(value) ? (
            <input
              id={`fm-${key}`}
              value={value.join(', ')}
              placeholder="comma separated"
              onChange={(event) =>
                commit({
                  ...draft,
                  [key]: event.target.value
                    .split(',')
                    .map((entry) => entry.trim())
                    .filter((entry) => entry.length > 0),
                })
              }
              className="w-full rounded border border-[var(--app-border)] bg-transparent px-2 py-1 outline-none focus:border-[var(--app-accent)]"
            />
          ) : (
            <input
              id={`fm-${key}`}
              type={typeof value === 'number' ? 'number' : 'text'}
              value={String(value)}
              onChange={(event) =>
                commit({
                  ...draft,
                  [key]:
                    typeof value === 'number' ? Number(event.target.value) : event.target.value,
                })
              }
              className="w-full rounded border border-[var(--app-border)] bg-transparent px-2 py-1 outline-none focus:border-[var(--app-accent)]"
            />
          )}
        </div>
      ))}

      <form
        className="flex gap-1 border-t border-[var(--app-border)] pt-2"
        onSubmit={(event) => {
          event.preventDefault();
          const key = newKey.trim();
          if (key.length === 0 || key in draft) return;
          setNewKey('');
          commit({ ...draft, [key]: '' });
        }}
      >
        <input
          value={newKey}
          placeholder="Add a field"
          aria-label="New field name"
          onChange={(event) => setNewKey(event.target.value)}
          className="min-w-0 flex-1 rounded border border-[var(--app-border)] bg-transparent px-2 py-1 outline-none focus:border-[var(--app-accent)]"
        />
        <button
          type="submit"
          className="rounded border border-[var(--app-border)] px-2 hover:bg-[var(--app-hover)]"
        >
          Add
        </button>
      </form>
    </div>
  );
}
