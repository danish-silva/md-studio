import { useEffect, useMemo, useRef, useState } from 'react';
import { appCommands, type AppCommand } from '../commands';
import { fsProvider } from '../fs';
import { fuzzyFilter } from '../lib/fuzzy';
import { basename } from '../lib/text';
import { useDocuments } from '../state/documents';

export interface CommandPaletteProps {
  /** Opening with '>' already typed starts in command mode, as VS Code does. */
  initialValue: string;
  onClose: () => void;
}

const MAX_RESULTS = 40;

export function CommandPalette({ initialValue, onClose }: CommandPaletteProps) {
  const [value, setValue] = useState(initialValue);
  const [files, setFiles] = useState<string[]>([]);
  const [selected, setSelected] = useState(0);
  const input = useRef<HTMLInputElement | null>(null);

  const commandMode = value.startsWith('>');
  const needle = commandMode ? value.slice(1).trim() : value.trim();

  useEffect(() => {
    input.current?.focus();
    input.current?.select();
  }, []);

  useEffect(() => {
    let cancelled = false;
    void fsProvider
      .findFiles()
      .then((found) => {
        if (!cancelled) setFiles(found);
      })
      .catch(() => {
        if (!cancelled) setFiles([]);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const commands = useMemo(() => (commandMode ? appCommands() : []), [commandMode, value]);

  const results = useMemo(() => {
    if (commandMode) {
      return fuzzyFilter(commands, needle, (command) => command.title, MAX_RESULTS).map(
        (match) => ({ key: match.item.id, item: match.item as AppCommand | string }),
      );
    }
    // Rank on the file name, fall back to the path, so "notes" beats a folder called notes.
    return fuzzyFilter(files, needle, (file) => `${basename(file)}  ${file}`, MAX_RESULTS).map(
      (match) => ({ key: match.item, item: match.item as AppCommand | string }),
    );
  }, [commandMode, commands, files, needle]);

  useEffect(() => {
    setSelected(0);
  }, [value]);

  const choose = (index: number) => {
    const result = results[index];
    if (!result) return;

    onClose();
    if (typeof result.item === 'string') {
      void useDocuments.getState().open(result.item);
    } else {
      result.item.run();
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/40 pt-[12vh]"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        role="dialog"
        aria-label={commandMode ? 'Run a command' : 'Open a file'}
        className="flex max-h-[60vh] w-[min(42rem,92vw)] flex-col overflow-hidden rounded-lg border border-[var(--app-border)] bg-[var(--app-panel)] shadow-2xl"
      >
        <input
          ref={input}
          value={value}
          placeholder="Type a file name, or > for commands"
          onChange={(event) => setValue(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Escape') {
              event.preventDefault();
              onClose();
            } else if (event.key === 'ArrowDown') {
              event.preventDefault();
              setSelected((index) => Math.min(index + 1, results.length - 1));
            } else if (event.key === 'ArrowUp') {
              event.preventDefault();
              setSelected((index) => Math.max(index - 1, 0));
            } else if (event.key === 'Enter') {
              event.preventDefault();
              choose(selected);
            }
          }}
          className="shrink-0 border-b border-[var(--app-border)] bg-transparent px-4 py-3 text-sm outline-none"
        />

        <ul className="min-h-0 flex-1 overflow-y-auto py-1">
          {results.length === 0 && (
            <li className="px-4 py-3 text-xs text-[var(--app-muted)]">
              {commandMode ? 'No matching command.' : 'No matching file.'}
            </li>
          )}

          {results.map((result, index) => {
            const isCommand = typeof result.item !== 'string';
            const title = isCommand ? (result.item as AppCommand).title : basename(result.key);
            const detail = isCommand ? (result.item as AppCommand).shortcut : result.key;

            return (
              <li key={result.key}>
                <button
                  type="button"
                  onMouseEnter={() => setSelected(index)}
                  onClick={() => choose(index)}
                  className={[
                    'flex w-full items-center gap-3 px-4 py-1.5 text-left text-[13px]',
                    index === selected ? 'bg-[var(--app-accent-soft)]' : '',
                  ].join(' ')}
                >
                  <span className="truncate">{title}</span>
                  {detail !== undefined && (
                    <span className="ml-auto shrink-0 truncate pl-4 text-[11px] text-[var(--app-muted)]">
                      {detail}
                    </span>
                  )}
                </button>
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}
