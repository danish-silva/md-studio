import { useState } from 'react';
import { useWorkspace } from '../state/workspace';
import { ContextMenu, type MenuItem } from './ContextMenu';
import { NamePrompt } from './NamePrompt';

type Prompt = { kind: 'new' } | { kind: 'rename' } | { kind: 'confirmDelete' } | null;

export function WorkspaceSwitcher() {
  const id = useWorkspace((state) => state.id);
  const name = useWorkspace((state) => state.name);
  const list = useWorkspace((state) => state.list);

  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const [prompt, setPrompt] = useState<Prompt>(null);

  const items: MenuItem[] = [
    ...list.map((entry) => ({
      label: `${entry.name}${entry.id === id ? '  ✓' : ''}`,
      onSelect: () => void useWorkspace.getState().switchTo(entry.id),
    })),
    { label: 'New workspace…', onSelect: () => setPrompt({ kind: 'new' }) },
    { label: 'Rename…', onSelect: () => setPrompt({ kind: 'rename' }) },
    {
      label: 'Delete workspace',
      danger: true,
      disabled: list.length < 2,
      onSelect: () => setPrompt({ kind: 'confirmDelete' }),
    },
  ];

  return (
    <div className="shrink-0 border-b border-[var(--app-border)]">
      <button
        type="button"
        aria-label="Workspace"
        title="Switch workspace"
        onClick={(event) => setMenu({ x: event.clientX, y: event.clientY })}
        className="flex w-full items-center gap-1 px-2 py-1.5 text-left text-xs hover:bg-[var(--app-hover)]"
      >
        <span className="truncate font-medium">{name}</span>
        <span aria-hidden className="ml-auto text-[10px] text-[var(--app-muted)]">
          ▾
        </span>
      </button>

      {prompt?.kind === 'new' && (
        <NamePrompt
          label="Name the new workspace"
          initialValue="Workspace"
          confirmLabel="Create"
          onConfirm={(value) => {
            setPrompt(null);
            void useWorkspace.getState().createWorkspace(value);
          }}
          onCancel={() => setPrompt(null)}
        />
      )}

      {prompt?.kind === 'rename' && (
        <NamePrompt
          label="Rename this workspace"
          initialValue={name}
          confirmLabel="Rename"
          onConfirm={(value) => {
            setPrompt(null);
            if (id !== null) void useWorkspace.getState().renameWorkspace(id, value);
          }}
          onCancel={() => setPrompt(null)}
        />
      )}

      {prompt?.kind === 'confirmDelete' && (
        <div className="flex flex-col gap-2 border-b border-[var(--app-border)] px-2 py-2 text-xs">
          <span>
            Delete the workspace <strong>{name}</strong>? Your files are not touched.
          </span>
          <span className="flex gap-1">
            <button
              type="button"
              onClick={() => {
                setPrompt(null);
                if (id !== null) void useWorkspace.getState().deleteWorkspace(id);
              }}
              className="rounded border border-red-500/50 px-2 py-0.5 text-red-200 hover:bg-red-500/20"
            >
              Delete
            </button>
            <button
              type="button"
              onClick={() => setPrompt(null)}
              className="rounded px-2 py-0.5 text-[var(--app-muted)] hover:bg-[var(--app-hover)]"
            >
              Cancel
            </button>
          </span>
        </div>
      )}

      {menu && <ContextMenu x={menu.x} y={menu.y} items={items} onClose={() => setMenu(null)} />}
    </div>
  );
}
