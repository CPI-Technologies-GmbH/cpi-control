import { create } from 'zustand';
import type {
  DeploymentProvider,
  DeploymentStatus,
  Environment,
  IncidentSeverity,
  IncidentStatus,
} from '@/types';

interface DeploymentFilterState {
  serviceId?: string;
  provider: DeploymentProvider[];
  status: DeploymentStatus[];
  environment: Environment[];
  setFilter: <K extends keyof Omit<DeploymentFilterState, 'setFilter' | 'resetFilters'>>(
    key: K,
    value: DeploymentFilterState[K]
  ) => void;
  resetFilters: () => void;
}

interface IncidentFilterState {
  serviceId?: string;
  customerId?: string;
  severity: IncidentSeverity[];
  status: IncidentStatus[];
  search: string;
  setFilter: <K extends keyof Omit<IncidentFilterState, 'setFilter' | 'resetFilters'>>(
    key: K,
    value: IncidentFilterState[K]
  ) => void;
  resetFilters: () => void;
}

export const useDeploymentFilterStore = create<DeploymentFilterState>((set) => ({
  serviceId: undefined,
  provider: [],
  status: [],
  environment: [],
  setFilter: (key, value) => set((s) => ({ ...s, [key]: value })),
  resetFilters: () =>
    set({ serviceId: undefined, provider: [], status: [], environment: [] }),
}));

export const useIncidentFilterStore = create<IncidentFilterState>((set) => ({
  serviceId: undefined,
  customerId: undefined,
  severity: [],
  status: [],
  search: '',
  setFilter: (key, value) => set((s) => ({ ...s, [key]: value })),
  resetFilters: () =>
    set({
      serviceId: undefined,
      customerId: undefined,
      severity: [],
      status: [],
      search: '',
    }),
}));
