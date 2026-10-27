import { lintMarkdown, localLinks, type Problem } from '@md-studio/markdown';
import { useEffect, useState } from 'react';
import { fsProvider } from '../fs';
import { parentDir, resolveRelative } from '../lib/text';
import { useDocuments } from '../state/documents';

/**
 * Advisory only: nothing here blocks a save except broken frontmatter, which the save
 * path checks for itself. The point is to be quiet enough to be worth reading.
 */
export function ProblemsPanel() {
  const doc = useDocuments((state) =>
    state.activePath === null ? null : (state.byPath[state.activePath] ?? null),
  );
  const [problems, setProblems] = useState<Problem[]>([]);
  const [checking, setChecking] = useState(false);

  useEffect(() => {
    if (doc === null) {
      setProblems([]);
      return;
    }

    // Linting on every keystroke would be wasteful; a pause is plenty.
    const timer = setTimeout(() => {
      void (async () => {
        setChecking(true);
        const found = lintMarkdown(doc.text);
        setProblems(found);

        const folder = parentDir(doc.path);
        if (folder !== null) {
          const broken = await brokenLinks(doc.text, folder);
          setProblems([...found, ...broken].sort((a, b) => a.line - b.line || a.column - b.column));
        }
        setChecking(false);
      })();
    }, 400);

    return () => clearTimeout(timer);
  }, [doc?.text, doc?.path, doc]);

  if (doc === null) {
    return <p className="px-3 py-3 text-xs text-[var(--app-muted)]">No document open.</p>;
  }

  if (problems.length === 0) {
    return (
      <p className="px-3 py-3 text-xs text-[var(--app-muted)]">
        {checking ? 'Checking…' : 'Nothing to report.'}
      </p>
    );
  }

  return (
    <ul className="h-full overflow-y-auto py-1">
      {problems.map((problem, index) => (
        <li
          key={`${problem.rule}:${String(problem.line)}:${String(index)}`}
          className="border-b border-[var(--app-border)]/50 px-2 py-1.5 text-[11px]"
        >
          <p className="flex items-start gap-1.5">
            <span
              aria-label={problem.severity}
              className={problem.severity === 'error' ? 'text-red-400' : 'text-amber-400'}
            >
              {problem.severity === 'error' ? '✕' : '!'}
            </span>
            <span className="min-w-0 flex-1 break-words">{problem.message}</span>
          </p>
          <p className="pl-4 text-[var(--app-muted)]">
            line {problem.line} · {problem.rule}
          </p>
        </li>
      ))}
    </ul>
  );
}

async function brokenLinks(text: string, folder: string): Promise<Problem[]> {
  const problems: Problem[] = [];

  for (const link of localLinks(text)) {
    const target = resolveRelative(folder, link.url);
    if (target === null) continue;

    const exists = await fsProvider
      .stat(target)
      .then(() => true)
      .catch(() => false);
    if (exists) continue;

    problems.push({
      severity: 'warning',
      rule: link.kind === 'image' ? 'missing-image' : 'missing-link',
      message: `${link.kind === 'image' ? 'Image' : 'Link'} target does not exist: ${link.url}`,
      line: link.line,
      column: link.column,
    });
  }

  return problems;
}
