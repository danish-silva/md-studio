import { create } from 'zustand';

const MIN_WIDTH = 160;
const MAX_WIDTH = 560;

/** Which of the stacked sidebar panels is showing. */
export type PanelId = 'files' | 'search' | 'outline' | 'problems';

/** Chrome rather than content. Width and collapse are part of the workspace file. */
export interface LayoutState {
  sidebarWidth: number;
  sidebarCollapsed: boolean;
  /** Not persisted: which panel you were last looking at is not worth restoring. */
  panel: PanelId;
  setSidebarWidth: (width: number) => void;
  toggleSidebar: () => void;
  setPanel: (panel: PanelId) => void;
  showSidebarPanel: (panel: PanelId) => void;
}

export const useLayout = create<LayoutState>((set, get) => ({
  sidebarWidth: 260,
  sidebarCollapsed: false,
  panel: 'files',

  setPanel: (panel) => set({ panel }),

  /** Opening a panel from a shortcut should also reveal the sidebar. */
  showSidebarPanel: (panel) => set({ panel, sidebarCollapsed: false }),

  setSidebarWidth: (width) =>
    set({ sidebarWidth: Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, Math.round(width))) }),

  toggleSidebar: () => set({ sidebarCollapsed: !get().sidebarCollapsed }),
}));
