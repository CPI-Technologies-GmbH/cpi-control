import { create } from 'zustand';
import type { Environment, HostingType, ServiceStatus } from '@/types';

interface ActiveFilters {
  customerId?: string;
  environments: Environment[];
  hostingTypes: HostingType[];
  statuses: ServiceStatus[];
  hasOpenIncident?: boolean;
  search: string;
}

interface UIState {
  sidebarOpen: boolean;
  toggleSidebar: () => void;
  setSidebarOpen: (open: boolean) => void;
  activeFilters: ActiveFilters;
  setFilter: <K extends keyof ActiveFilters>(key: K, value: ActiveFilters[K]) => void;
  resetFilters: () => void;
}

const defaultFilters: ActiveFilters = {
  customerId: undefined,
  environments: [],
  hostingTypes: [],
  statuses: [],
  hasOpenIncident: undefined,
  search: '',
};

export const useUIStore = create<UIState>((set) => ({
  sidebarOpen: true,
  toggleSidebar: () => set((s) => ({ sidebarOpen: !s.sidebarOpen })),
  setSidebarOpen: (open) => set({ sidebarOpen: open }),
  activeFilters: { ...defaultFilters },
  setFilter: (key, value) =>
    set((s) => ({
      activeFilters: { ...s.activeFilters, [key]: value },
    })),
  resetFilters: () => set({ activeFilters: { ...defaultFilters } }),
}));
