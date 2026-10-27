import { Explorer } from './Explorer';
import { FrontmatterPanel } from './FrontmatterPanel';
import { GitPanel } from './GitPanel';
import { HistoryPanel } from './HistoryPanel';
import { OutlinePanel } from './OutlinePanel';
import { ProblemsPanel } from './ProblemsPanel';
import { SearchPanel } from './SearchPanel';
import { TabList } from './TabList';
import { WorkspaceSwitcher } from './WorkspaceSwitcher';
import { useLayout, type PanelId } from '../state/layout';

const PANELS: { id: PanelId; label: string; title: string }[] = [
  { id: 'files', label: 'Files', title: 'Files (Ctrl+Shift+E)' },
  { id: 'search', label: 'Search', title: 'Search all folders (Ctrl+Shift+F)' },
  { id: 'outline', label: 'Outline', title: 'Headings in this document' },
  { id: 'problems', label: 'Problems', title: 'Lint and link checks' },
  { id: 'frontmatter', label: 'Fields', title: 'Frontmatter as a form' },
  { id: 'history', label: 'History', title: 'Versions of this file' },
  { id: 'git', label: 'Git', title: 'Changes, staging and commits' },
];

export function Sidebar() {
  const panel = useLayout((state) => state.panel);

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <WorkspaceSwitcher />
      <TabList />

      <nav
        aria-label="Sidebar panels"
        className="flex shrink-0 flex-wrap border-b border-[var(--app-border)] text-[11px]"
      >
        {PANELS.map((entry) => (
          <button
            key={entry.id}
            type="button"
            title={entry.title}
            aria-current={panel === entry.id ? 'true' : undefined}
            onClick={() => useLayout.getState().setPanel(entry.id)}
            className={[
              'min-w-14 flex-1 px-1 py-1.5 uppercase tracking-wider',
              panel === entry.id
                ? 'border-b-2 border-[var(--app-accent)] text-[var(--app-text)]'
                : 'border-b-2 border-transparent text-[var(--app-muted)] hover:bg-[var(--app-hover)]',
            ].join(' ')}
          >
            {entry.label}
          </button>
        ))}
      </nav>

      <div className="min-h-0 flex-1 overflow-hidden">
        {panel === 'files' && <Explorer />}
        {panel === 'search' && <SearchPanel />}
        {panel === 'outline' && <OutlinePanel />}
        {panel === 'problems' && <ProblemsPanel />}
        {panel === 'frontmatter' && <FrontmatterPanel />}
        {panel === 'history' && <HistoryPanel />}
        {panel === 'git' && <GitPanel />}
      </div>
    </div>
  );
}
