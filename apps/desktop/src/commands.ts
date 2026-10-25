import { useDocuments } from './state/documents';
import { useExplorer } from './state/explorer';
import { useFind } from './state/find';
import { useLayout } from './state/layout';
import { parentDir } from './lib/text';

export interface AppCommand {
  id: string;
  title: string;
  shortcut?: string;
  run: () => void;
}

/**
 * Everything the palette can run.
 *
 * Built fresh on each call so "Close tab" can tell whether there is a tab, rather than
 * offering an action that quietly does nothing.
 */
export function appCommands(): AppCommand[] {
  const documents = useDocuments.getState();
  const layout = useLayout.getState();
  const hasDocument = documents.activePath !== null;

  const commands: AppCommand[] = [
    {
      id: 'find',
      title: 'Find in document',
      shortcut: 'Ctrl+F',
      run: () => useFind.getState().openFind(false),
    },
    {
      id: 'replace',
      title: 'Replace in document',
      shortcut: 'Ctrl+H',
      run: () => useFind.getState().openFind(true),
    },
    {
      id: 'search',
      title: 'Search in all folders',
      shortcut: 'Ctrl+Shift+F',
      run: () => useLayout.getState().showSidebarPanel('search'),
    },
    {
      id: 'panel.files',
      title: 'Show files',
      shortcut: 'Ctrl+Shift+E',
      run: () => useLayout.getState().showSidebarPanel('files'),
    },
    {
      id: 'panel.outline',
      title: 'Show outline',
      run: () => useLayout.getState().showSidebarPanel('outline'),
    },
    {
      id: 'panel.problems',
      title: 'Show problems',
      run: () => useLayout.getState().showSidebarPanel('problems'),
    },
    {
      id: 'sidebar',
      title: layout.sidebarCollapsed ? 'Show sidebar' : 'Hide sidebar',
      shortcut: 'Ctrl+\\',
      run: () => useLayout.getState().toggleSidebar(),
    },
  ];

  if (hasDocument) {
    commands.unshift(
      { id: 'save', title: 'Save', shortcut: 'Ctrl+S', run: () => void useDocuments.getState().save() },
      {
        id: 'saveAll',
        title: 'Save all',
        shortcut: 'Ctrl+Shift+S',
        run: () => void useDocuments.getState().saveAll(),
      },
      {
        id: 'mode',
        title: 'Toggle markdown source view',
        shortcut: 'Ctrl+Shift+M',
        run: () => useDocuments.getState().toggleMode(),
      },
      {
        id: 'close',
        title: 'Close tab',
        shortcut: 'Ctrl+W',
        run: () => {
          const active = useDocuments.getState().activePath;
          if (active !== null) useDocuments.getState().requestClose(active);
        },
      },
      {
        id: 'pin',
        title: documents.byPath[documents.activePath ?? '']?.pinned === true ? 'Unpin tab' : 'Pin tab',
        run: () => {
          const active = useDocuments.getState().activePath;
          if (active !== null) useDocuments.getState().togglePin(active);
        },
      },
      {
        id: 'nextTab',
        title: 'Next tab',
        shortcut: 'Alt+Down',
        run: () => useDocuments.getState().activateRelative(1),
      },
      {
        id: 'previousTab',
        title: 'Previous tab',
        shortcut: 'Alt+Up',
        run: () => useDocuments.getState().activateRelative(-1),
      },
    );
  }

  const folder = documents.activePath !== null ? parentDir(documents.activePath) : useExplorer.getState().roots[0] ?? null;
  if (folder !== null) {
    commands.push({
      id: 'newFile',
      title: 'New markdown file',
      run: () => {
        void (async () => {
          const created = await useExplorer.getState().createFile(folder, untitledName());
          if (created !== null) void useDocuments.getState().open(created);
        })();
      },
    });
  }

  return commands;
}

function untitledName(): string {
  const now = new Date();
  const pad = (value: number) => String(value).padStart(2, '0');
  return `untitled-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}.md`;
}
