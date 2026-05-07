import { create } from 'zustand';
import { api, Project, Session, Stats } from '../api';

export type SortField = 'modified' | 'created' | 'messageCount' | 'diskSize';
export type SortOrder = 'asc' | 'desc';
export type EmptyFilter = '' | 'true' | 'false';

interface AppState {
  projects: Project[];
  currentProject: string | null;
  sessions: Session[];
  selected: Set<string>;
  sortField: SortField;
  sortOrder: SortOrder;
  emptyFilter: EmptyFilter;
  searchQuery: string;
  stats: Stats | null;
  loading: boolean;

  // Actions
  loadStats: () => Promise<void>;
  loadProjects: () => Promise<void>;
  loadSessions: (dirName?: string | null) => Promise<void>;
  setCurrentProject: (dirName: string | null) => void;
  setSortField: (field: SortField) => void;
  setSortOrder: (order: SortOrder) => void;
  setEmptyFilter: (filter: EmptyFilter) => void;
  setSearchQuery: (query: string) => void;
  doSearch: (query: string) => Promise<void>;
  doDeepSearch: (query: string) => Promise<Session[]>;
  toggleSelect: (sessionId: string) => void;
  selectAll: () => void;
  clearSelection: () => void;
  deleteSession: (sessionId: string) => Promise<void>;
  batchDelete: () => Promise<{ deleted: number; failed: number }>;
  setTitle: (sessionId: string, title: string) => Promise<void>;
  autoRename: (sessionId: string) => Promise<string>;
  refresh: () => Promise<void>;
}

export const useStore = create<AppState>((set, get) => ({
  projects: [],
  currentProject: null,
  sessions: [],
  selected: new Set(),
  sortField: 'modified',
  sortOrder: 'desc',
  emptyFilter: '',
  searchQuery: '',
  stats: null,
  loading: false,

  loadStats: async () => {
    const stats = await api.getStats();
    set({ stats });
  },

  loadProjects: async () => {
    const { projects } = await api.getProjects();
    set({ projects });
  },

  loadSessions: async (dirName) => {
    const { sortField, sortOrder, emptyFilter } = get();
    const project = dirName ?? get().currentProject;
    set({ loading: true });
    try {
      if (project) {
        const { sessions, projectPath } = await api.getSessions(project, {
          sort: sortField,
          order: sortOrder,
          empty: emptyFilter || undefined,
        });
        // Attach projectPath to each session for resume command display
        const enriched = sessions.map((s) => ({ ...s, projectPath }));
        set({ sessions: enriched, selected: new Set() });
      } else {
        // All Projects - use search endpoint without query
        const { results } = await api.search('', { empty: emptyFilter || undefined });
        const sorted = sortSessions(results, sortField, sortOrder);
        set({ sessions: sorted, selected: new Set() });
      }
    } finally {
      set({ loading: false });
    }
  },

  setCurrentProject: (dirName) => {
    set({ currentProject: dirName, searchQuery: '', selected: new Set() });
    get().loadSessions(dirName);
  },

  setSortField: (field) => {
    set({ sortField: field });
    const { searchQuery } = get();
    if (searchQuery) {
      get().doSearch(searchQuery);
    } else {
      get().loadSessions();
    }
  },

  setSortOrder: (order) => {
    set({ sortOrder: order });
    const { searchQuery } = get();
    if (searchQuery) {
      get().doSearch(searchQuery);
    } else {
      get().loadSessions();
    }
  },

  setEmptyFilter: (filter) => {
    set({ emptyFilter: filter });
    const { searchQuery } = get();
    if (searchQuery) {
      get().doSearch(searchQuery);
    } else {
      get().loadSessions();
    }
  },

  setSearchQuery: (query) => set({ searchQuery: query }),

  doSearch: async (query) => {
    if (!query.trim()) {
      get().loadSessions();
      return;
    }
    set({ loading: true });
    try {
      const { emptyFilter, currentProject, sortField, sortOrder } = get();
      const { results } = await api.search(query, {
        project: currentProject || undefined,
        empty: emptyFilter || undefined,
      });
      // Client-side sort
      const sorted = sortSessions(results, sortField, sortOrder);
      set({ sessions: sorted, selected: new Set() });
    } finally {
      set({ loading: false });
    }
  },

  doDeepSearch: async (query) => {
    const { results } = await api.deepSearch(query);
    set({ sessions: results, selected: new Set() });
    return results;
  },

  toggleSelect: (sessionId) => {
    const selected = new Set(get().selected);
    if (selected.has(sessionId)) selected.delete(sessionId);
    else selected.add(sessionId);
    set({ selected });
  },

  selectAll: () => {
    const { sessions, selected } = get();
    if (selected.size === sessions.length) {
      set({ selected: new Set() });
    } else {
      set({ selected: new Set(sessions.map((s) => s.sessionId)) });
    }
  },

  clearSelection: () => set({ selected: new Set() }),

  deleteSession: async (sessionId) => {
    await api.deleteSession(sessionId);
    set((state) => ({
      sessions: state.sessions.filter((s) => s.sessionId !== sessionId),
      selected: (() => {
        const next = new Set(state.selected);
        next.delete(sessionId);
        return next;
      })(),
    }));
    get().loadProjects();
    get().loadStats();
  },

  batchDelete: async () => {
    const { selected } = get();
    const result = await api.batchDelete([...selected]);
    set((state) => ({
      sessions: state.sessions.filter((s) => !state.selected.has(s.sessionId)),
      selected: new Set(),
    }));
    get().loadProjects();
    get().loadStats();
    return result;
  },

  setTitle: async (sessionId, title) => {
    await api.setTitle(sessionId, title);
    set((state) => ({
      sessions: state.sessions.map((s) =>
        s.sessionId === sessionId ? { ...s, customTitle: title || null } : s
      ),
    }));
  },

  autoRename: async (sessionId) => {
    const { title } = await api.autoRename(sessionId);
    set((state) => ({
      sessions: state.sessions.map((s) =>
        s.sessionId === sessionId ? { ...s, customTitle: title } : s
      ),
    }));
    return title;
  },

  refresh: async () => {
    await Promise.all([get().loadStats(), get().loadProjects()]);
    const { currentProject, searchQuery } = get();
    if (searchQuery) {
      get().doSearch(searchQuery);
    } else if (currentProject) {
      get().loadSessions();
    }
  },
}));

function sortSessions(sessions: Session[], field: SortField, order: SortOrder): Session[] {
  return [...sessions].sort((a, b) => {
    let cmp = 0;
    if (field === 'modified' || field === 'created') {
      cmp = (a[field] || '').localeCompare(b[field] || '');
    } else {
      cmp = (a[field] || 0) - (b[field] || 0);
    }
    return order === 'desc' ? -cmp : cmp;
  });
}
