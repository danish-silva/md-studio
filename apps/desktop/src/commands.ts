import { useDocuments } from './state/documents';
import { useExplorer } from './state/explorer';
import { useFind } from './state/find';
import { useLayout } from './state/layout';
import { useNavigate } from './state/navigate';
import { expandTemplate, useSettings } from './state/settings';
import { useUpdates } from './state/updates';
import { exportDocument, printDocument } from './lib/export';
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
      id: 'settings',
      title: 'Open settings',
      shortcut: 'Ctrl+,',
      run: () => useLayout.getState().setSettingsOpen(true),
    },
    {
      id: 'panel.frontmatter',
      title: 'Show frontmatter fields',
      run: () => useLayout.getState().showSidebarPanel('frontmatter'),
    },
    {
      id: 'updates',
      title: 'Check for updates',
      run: () => void useUpdates.getState().check(),
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

  if (hasDocument) {
    commands.push(
      documents.secondaryPath === null
        ? {
            id: 'split',
            title: 'Split the editor',
            run: () => useDocuments.getState().splitEditor(),
          }
        : {
            id: 'unsplit',
            title: 'Close the split',
            run: () => useDocuments.getState().closeSplit(),
          },
    );

    const active = documents.byPath[documents.activePath ?? ''];
    if (active) {
      commands.push(
        {
          id: 'export.html',
          title: 'Export as HTML',
          run: () => void report(exportDocument('html', active.path, active.text)),
        },
        {
          id: 'export.docx',
          title: 'Export as Word (.docx)',
          run: () => void report(exportDocument('docx', active.path, active.text)),
        },
        {
          id: 'export.pdf',
          title: 'Print, or save as PDF',
          run: () => {
            try {
              printDocument(active.path, active.text);
            } catch (error) {
              useDocuments.getState().reportError(describe(error));
            }
          },
        },
        {
          id: 'panel.history',
          title: 'Show version history',
          run: () => useLayout.getState().showSidebarPanel('history'),
        },
        {
          id: 'panel.git',
          title: 'Show git changes',
          run: () => useLayout.getState().showSidebarPanel('git'),
        },
      );
    }

    for (const template of useSettings.getState().templates) {
      commands.push({
        id: `template.insert.${template.id}`,
        title: `Insert template: ${template.name}`,
        run: () => useNavigate.getState().insertMarkdown(expandTemplate(template.body)),
      });
    }
  }

  const folder = documents.activePath !== null ? parentDir(documents.activePath) : useExplorer.getState().roots[0] ?? null;
  if (folder !== null) {
    commands.push({
      id: 'newFile',
      title: 'New markdown file',
      run: () => void createFrom(folder, ''),
    });

    for (const template of useSettings.getState().templates) {
      commands.push({
        id: `template.new.${template.id}`,
        title: `New file from template: ${template.name}`,
        run: () => void createFrom(folder, expandTemplate(template.body)),
      });
    }
  }

  return commands;
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Exporting is slow enough to be worth confirming, and can fail on the way out. */
async function report(work: Promise<string | null>): Promise<void> {
  try {
    const target = await work;
    if (target !== null) useDocuments.getState().notify(`Exported to ${target}`);
  } catch (error) {
    useDocuments.getState().reportError(describe(error));
  }
}

async function createFrom(folder: string, body: string): Promise<void> {
  const created = await useExplorer.getState().createFile(folder, untitledName());
  if (created === null) return;

  await useDocuments.getState().open(created);
  if (body.length > 0) {
    useDocuments.getState().replaceText(created, body);
    // Written straight away, so the file on disk matches what is on screen.
    await useDocuments.getState().save(created);
  }
}

function untitledName(): string {
  const now = new Date();
  const pad = (value: number) => String(value).padStart(2, '0');
  return `untitled-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}.md`;
}
