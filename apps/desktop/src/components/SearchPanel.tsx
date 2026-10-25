import { useCallback, useMemo, useState } from 'react';
import { fsProvider } from '../fs';
import type { ContentMatch } from '../fs/types';
import { basename, samePath } from '../lib/text';
import { useDocuments } from '../state/documents';
import { useFind } from '../state/find';

interface Outcome {
  replaced: number;
  files: number;
  skipped: string[];
}

/** Search across every folder in the workspace, with an optional replace. */
export function SearchPanel() {
  const [query, setQuery] = useState('');
  const [replacement, setReplacement] = useState('');
  const [regex, setRegex] = useState(false);
  const [caseSensitive, setCaseSensitive] = useState(false);

  const [matches, setMatches] = useState<ContentMatch[]>([]);
  const [truncated, setTruncated] = useState(false);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [outcome, setOutcome] = useState<Outcome | null>(null);

  const byFile = useMemo(() => {
    const groups = new Map<string, ContentMatch[]>();
    for (const match of matches) {
      groups.set(match.path, [...(groups.get(match.path) ?? []), match]);
    }
    return [...groups.entries()];
  }, [matches]);

  const run = useCallback(async () => {
    if (query.trim().length === 0) {
      setMatches([]);
      return;
    }

    setSearching(true);
    setError(null);
    setOutcome(null);
    try {
      const result = await fsProvider.searchContent({ query, regex, caseSensitive });
      setMatches(result.matches);
      setTruncated(result.truncated);
    } catch (problem) {
      setError(problem instanceof Error ? problem.message : String(problem));
      setMatches([]);
    } finally {
      setSearching(false);
    }
  }, [caseSensitive, query, regex]);

  /**
   * Replacement goes through the file on disk. A document with unsaved changes is left
   * alone and reported, rather than having the user's edits overwritten underneath them.
   */
  const replaceEverywhere = useCallback(async () => {
    setConfirming(false);
    setSearching(true);

    const documents = useDocuments.getState();
    const pattern = new RegExp(
      regex ? query : query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'),
      caseSensitive ? 'g' : 'gi',
    );

    const skipped: string[] = [];
    let replaced = 0;
    let touched = 0;

    try {
      for (const [path] of byFile) {
        const open = documents.order.find((entry) => samePath(entry, path));
        if (open !== undefined && documents.byPath[open]?.dirty === true) {
          skipped.push(path);
          continue;
        }

        const contents = await fsProvider.readFile(path);
        pattern.lastIndex = 0;
        const count = contents.text.match(pattern)?.length ?? 0;
        if (count === 0) continue;

        pattern.lastIndex = 0;
        await fsProvider.writeFile(path, contents.text.replace(pattern, replacement));
        replaced += count;
        touched += 1;
      }
      setOutcome({ replaced, files: touched, skipped });
      await run();
    } catch (problem) {
      setError(problem instanceof Error ? problem.message : String(problem));
    } finally {
      setSearching(false);
    }
  }, [byFile, caseSensitive, query, regex, replacement, run]);

  const openMatch = (match: ContentMatch) => {
    void useDocuments.getState().open(match.path);
    // Hand the same query to the in-document find, so the hit is highlighted wherever
    // the caret lands — no fragile line-to-position mapping needed.
    const find = useFind.getState();
    find.setRegex(regex);
    find.setCaseSensitive(caseSensitive);
    find.setQuery(query);
    find.openFind(false);
  };

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <form
        className="shrink-0 space-y-1.5 border-b border-[var(--app-border)] p-2"
        onSubmit={(event) => {
          event.preventDefault();
          void run();
        }}
      >
        <input
          value={query}
          placeholder="Search all folders"
          aria-label="Search"
          onChange={(event) => setQuery(event.target.value)}
          className="w-full rounded border border-[var(--app-border)] bg-transparent px-2 py-1 text-xs outline-none focus:border-[var(--app-accent)]"
        />
        <input
          value={replacement}
          placeholder="Replace with"
          aria-label="Replace with"
          onChange={(event) => setReplacement(event.target.value)}
          className="w-full rounded border border-[var(--app-border)] bg-transparent px-2 py-1 text-xs outline-none focus:border-[var(--app-accent)]"
        />

        <div className="flex items-center gap-2 text-[11px] text-[var(--app-muted)]">
          <label className="flex items-center gap-1">
            <input type="checkbox" checked={caseSensitive} onChange={(e) => setCaseSensitive(e.target.checked)} />
            Aa
          </label>
          <label className="flex items-center gap-1">
            <input type="checkbox" checked={regex} onChange={(e) => setRegex(e.target.checked)} />
            Regex
          </label>
          <button
            type="submit"
            disabled={searching}
            className="ml-auto rounded border border-[var(--app-border)] px-2 py-0.5 hover:bg-[var(--app-hover)] disabled:opacity-40"
          >
            {searching ? 'Working…' : 'Search'}
          </button>
        </div>

        {matches.length > 0 && (
          <button
            type="button"
            disabled={searching}
            onClick={() => setConfirming(true)}
            className="w-full rounded border border-[var(--app-border)] px-2 py-0.5 text-[11px] hover:bg-[var(--app-hover)] disabled:opacity-40"
          >
            Replace {matches.length} in {byFile.length} file{byFile.length === 1 ? '' : 's'}
          </button>
        )}
      </form>

      {confirming && (
        <div className="shrink-0 space-y-2 border-b border-[var(--app-border)] p-2 text-[11px]">
          <p>
            Replace {matches.length} match{matches.length === 1 ? '' : 'es'} across{' '}
            {byFile.length} file{byFile.length === 1 ? '' : 's'}? This writes to disk.
          </p>
          <span className="flex gap-1">
            <button
              type="button"
              onClick={() => void replaceEverywhere()}
              className="rounded border border-red-500/50 px-2 py-0.5 text-red-200 hover:bg-red-500/20"
            >
              Replace
            </button>
            <button
              type="button"
              onClick={() => setConfirming(false)}
              className="rounded px-2 py-0.5 text-[var(--app-muted)] hover:bg-[var(--app-hover)]"
            >
              Cancel
            </button>
          </span>
        </div>
      )}

      {error !== null && (
        <p role="alert" className="shrink-0 border-b border-red-500/40 bg-red-500/10 px-2 py-1 text-[11px] text-red-200">
          {error}
        </p>
      )}

      {outcome !== null && (
        <p className="shrink-0 border-b border-[var(--app-border)] px-2 py-1 text-[11px] text-[var(--app-muted)]">
          Replaced {outcome.replaced} in {outcome.files} file{outcome.files === 1 ? '' : 's'}.
          {outcome.skipped.length > 0 &&
            ` Skipped ${String(outcome.skipped.length)} with unsaved changes.`}
        </p>
      )}

      <div className="min-h-0 flex-1 overflow-y-auto">
        {matches.length === 0 && !searching && (
          <p className="px-3 py-3 text-xs text-[var(--app-muted)]">No results yet.</p>
        )}

        {byFile.map(([path, hits]) => (
          <div key={path} className="border-b border-[var(--app-border)]/50">
            <p className="truncate px-2 pt-1.5 text-[11px] font-medium" title={path}>
              {basename(path)}{' '}
              <span className="text-[var(--app-muted)]">({hits.length})</span>
            </p>
            <ul className="pb-1">
              {hits.map((hit) => (
                <li key={`${hit.line}:${hit.column}`}>
                  <button
                    type="button"
                    onClick={() => openMatch(hit)}
                    className="flex w-full gap-2 px-2 py-0.5 text-left text-[11px] hover:bg-[var(--app-hover)]"
                  >
                    <span className="shrink-0 text-[var(--app-muted)]">{hit.line}</span>
                    <span className="truncate font-mono">{hit.preview.trim()}</span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        ))}

        {truncated && (
          <p className="px-3 py-2 text-[11px] text-[var(--app-muted)]">
            Showing the first {matches.length} matches.
          </p>
        )}
      </div>
    </div>
  );
}
