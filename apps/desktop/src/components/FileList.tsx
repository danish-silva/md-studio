import type { DirEntry } from '../fs/types';
import { isMarkdownPath, parentDir } from '../lib/text';

export interface FileListProps {
  dirPath: string | null;
  entries: DirEntry[];
  activePath: string | null;
  onOpenDir: (dirPath: string) => void;
  onOpenFile: (filePath: string) => void;
}

/**
 * A placeholder explorer good enough to open a file in P0. P4 replaces it with the real
 * multi-root tree: watching, file operations, drag-move and virtualisation.
 */
export function FileList({ dirPath, entries, activePath, onOpenDir, onOpenFile }: FileListProps) {
  const parent = dirPath === null ? null : parentDir(dirPath);

  return (
    <nav className="flex h-full flex-col overflow-hidden">
      <header className="shrink-0 border-b border-[var(--app-border)] px-3 py-2">
        <p className="text-[11px] font-medium uppercase tracking-wider text-[var(--app-muted)]">
          Explorer
        </p>
        <p className="mt-1 truncate text-xs text-[var(--app-muted)]" title={dirPath ?? ''}>
          {dirPath ?? 'No folder'}
        </p>
      </header>

      <ul className="min-h-0 flex-1 overflow-y-auto py-1 text-sm">
        {parent !== null && (
          <li>
            <button
              type="button"
              onClick={() => onOpenDir(parent)}
              className="w-full px-3 py-1 text-left text-[var(--app-muted)] hover:bg-[var(--app-hover)]"
            >
              ..
            </button>
          </li>
        )}

        {entries.map((entry) => {
          const isDir = entry.kind === 'directory';
          const openable = isDir || isMarkdownPath(entry.path);
          const active = entry.path === activePath;

          return (
            <li key={entry.path}>
              <button
                type="button"
                disabled={!openable}
                title={openable ? entry.path : 'Not a markdown file'}
                onClick={() => (isDir ? onOpenDir(entry.path) : onOpenFile(entry.path))}
                className={[
                  'flex w-full items-center gap-2 px-3 py-1 text-left',
                  openable ? 'hover:bg-[var(--app-hover)]' : 'cursor-default opacity-40',
                  active ? 'bg-[var(--app-accent-soft)] text-[var(--app-text)]' : '',
                ].join(' ')}
              >
                <span aria-hidden className="w-3 shrink-0 text-[var(--app-muted)]">
                  {isDir ? '▸' : ''}
                </span>
                <span className="truncate">{entry.name}</span>
              </button>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
