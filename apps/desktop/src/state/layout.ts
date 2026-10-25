import { create } from 'zustand';

const MIN_WIDTH = 160;
const MAX_WIDTH = 560;

/** Chrome rather than content, but it belongs to the workspace file in P6. */
export interface LayoutState {
  sidebarWidth: number;
  sidebarCollapsed: boolean;
  setSidebarWidth: (width: number) => void;
  toggleSidebar: () => void;
}

export const useLayout = create<LayoutState>((set, get) => ({
  sidebarWidth: 260,
  sidebarCollapsed: false,

  setSidebarWidth: (width) =>
    set({ sidebarWidth: Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, Math.round(width))) }),

  toggleSidebar: () => set({ sidebarCollapsed: !get().sidebarCollapsed }),
}));
