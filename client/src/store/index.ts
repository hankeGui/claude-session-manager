import { create } from 'zustand';
import { api, Project, Session, Stats } from '../api';

// Module-level variable so startAiScanPoll closure and dismissAiScanError can share state
let _suppressedAiScanError: string | null = null;

export type AppView = 'sessions' | 'scheduler';
export type SortField = 'modified' | 'created' | 'messageCount' | 'diskSize';
export type SortOrder = 'asc' | 'desc';
export type EmptyFilter = '' | 'true' | 'false';
export type SearchMode = 'default' | 'regex';

export interface AiTask {
  sessionId: string;
  sessionTitle: string;
  status: 'pending' | 'running' | 'done' | 'error';
  result?: string;
  error?: string;
}

export interface BatchRenameState {
  running: boolean;
  total: number;
  done: number;
  failed: number;
  skipped: number;
  results: { sessionId: string; title?: string; status: 'done' | 'error' | 'skipped' }[];
}

interface AppState {
  currentView: AppView;
  projects: Project[];
  currentProject: string | null;
  sessions: Session[];
  selected: Set<string>;
  sortField: SortField;
  sortOrder: SortOrder;
  emptyFilter: EmptyFilter;
  searchMode: SearchMode;
  searchQuery: string;
  stats: Stats | null;
  loading: boolean;
  aiTask: AiTask | null;
  aiTaskMinimized: boolean;
  batchRename: BatchRenameState | null;

  // Actions
  setView: (view: AppView) => void;
  loadStats: () => Promise<void>;
  loadProjects: () => Promise<void>;
  loadSessions: (dirName?: string | null) => Promise<void>;
  setCurrentProject: (dirName: string | null) => void;
  setSortField: (field: SortField) => void;
  setSortOrder: (order: SortOrder) => void;
  setEmptyFilter: (filter: EmptyFilter) => void;
  setSearchMode: (mode: SearchMode) => void;
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
  setFavorite: (sessionId: string, isFavorite: boolean) => Promise<void>;
  startAiRename: (sessionId: string, sessionTitle: string) => void;
  dismissAiTask: () => void;
  toggleAiTaskMinimized: () => void;
  startBatchRename: (forceAll?: boolean) => void;
  dismissBatchRename: () => void;
  refresh: () => Promise<{ success: boolean; projects: number; sessions: number; pending: { summaries: number; titles: number } }>;
  aiScanStatus: { running: boolean; paused: boolean; cancelled: boolean; phase: string; total: number; done: number; error?: string | null; result?: { summaries: number; titles: number; skipped: number } | null } | null;
  startAiScanPoll: () => void;
  dismissAiScanError: () => void;
  showAiConfig: boolean;
  setShowAiConfig: (show: boolean) => void;
}

export const useStore = create<AppState>((set, get) => ({
  currentView: 'sessions',
  projects: [],
  currentProject: null,
  sessions: [],
  selected: new Set(),
  sortField: 'modified',
  sortOrder: 'desc',
  emptyFilter: '',
  searchMode: 'default' as SearchMode,
  searchQuery: '',
  stats: null,
  loading: true,
  aiTask: null,
  aiTaskMinimized: false,
  batchRename: null,
  showAiConfig: false,
  setShowAiConfig: (show: boolean) => set({ showAiConfig: show }),

  setView: (view) => set({ currentView: view }),

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
      if (project === '__favorites__') {
        // Favorites view - fetch only favorited sessions
        const { results } = await api.search('', { empty: emptyFilter || undefined, favorite: 'true' });
        const sorted = sortSessions(results, sortField, sortOrder);
        set({ sessions: sorted, selected: new Set() });
      } else if (project) {
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

  setSearchMode: (mode) => set({ searchMode: mode }),
  setSearchQuery: (query) => set({ searchQuery: query }),

  doSearch: async (query) => {
    if (!query.trim()) {
      get().loadSessions();
      return;
    }
    set({ loading: true });
    try {
      const { emptyFilter, currentProject, sortField, sortOrder, searchMode } = get();
      const { results } = await api.search(query, {
        project: currentProject && currentProject !== '__favorites__' ? currentProject : undefined,
        empty: emptyFilter || undefined,
        mode: searchMode !== 'default' ? searchMode : undefined,
        favorite: currentProject === '__favorites__' ? 'true' : undefined,
      });
      // Client-side sort (skip if search already scored results)
      const sorted = query.trim() ? results : sortSessions(results, sortField, sortOrder);
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

  setFavorite: async (sessionId, isFavorite) => {
    await api.setFavorite(sessionId, isFavorite);
    set((state) => ({
      sessions: state.sessions.map((s) =>
        s.sessionId === sessionId ? { ...s, isFavorite } : s
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

  startAiRename: (sessionId, sessionTitle) => {
    const { aiTask } = get();
    if (aiTask && aiTask.status === 'running') return; // one at a time
    set({
      aiTask: { sessionId, sessionTitle, status: 'running' },
      aiTaskMinimized: false,
    });
    api.autoRename(sessionId).then(({ title }) => {
      set((state) => ({
        aiTask: { ...state.aiTask!, status: 'done', result: title },
        sessions: state.sessions.map((s) =>
          s.sessionId === sessionId ? { ...s, customTitle: title } : s
        ),
      }));
    }).catch((err) => {
      set((state) => ({
        aiTask: { ...state.aiTask!, status: 'error', error: err.message },
      }));
    });
  },

  dismissAiTask: () => set({ aiTask: null }),

  toggleAiTaskMinimized: () => set((state) => ({ aiTaskMinimized: !state.aiTaskMinimized })),

  startBatchRename: async (forceAll?: boolean) => {
    const { selected, batchRename, sessions } = get();
    if (batchRename?.running) return;
    let sessionIds = [...selected];
    if (sessionIds.length === 0) return;

    // Check if some sessions already have customTitle
    if (!forceAll) {
      const alreadyNamed = sessions.filter(s => sessionIds.includes(s.sessionId) && s.customTitle);
      if (alreadyNamed.length > 0 && alreadyNamed.length === sessionIds.length) {
        // All selected are already named — ask user
        const { confirm } = await import('../components/ConfirmDialog');
        const { confirmed } = await confirm({
          title: 'All Selected Already Renamed',
          message: `All ${alreadyNamed.length} selected sessions already have AI-generated titles. What would you like to do?`,
          okText: 'Regenerate All',
          okClass: 'success',
        });
        if (!confirmed) return;
        // User wants to regenerate — pass force flag to backend
      } else if (alreadyNamed.length > 0) {
        const { confirm } = await import('../components/ConfirmDialog');
        const { confirmed, checked } = await confirm({
          title: 'Some Already Renamed',
          message: `${alreadyNamed.length} of ${sessionIds.length} selected sessions already have titles.`,
          okText: 'Continue',
          okClass: 'success',
          checkbox: { label: `Regenerate ${alreadyNamed.length} existing titles`, defaultChecked: false },
        });
        if (!confirmed) return;
        if (!checked) {
          // Skip already named ones
          sessionIds = sessionIds.filter(id => !alreadyNamed.some(s => s.sessionId === id));
          if (sessionIds.length === 0) return;
        }
      }
    }

    set({ batchRename: { running: true, total: 0, done: 0, failed: 0, skipped: 0, results: [] } });

    api.batchRename(sessionIds).then(async (response) => {
      const reader = response.body?.getReader();
      if (!reader) return;
      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';
        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          try {
            const event = JSON.parse(line.slice(6));
            if (event.type === 'start') {
              set((s) => ({ batchRename: { ...s.batchRename!, total: event.total, skipped: event.skipped } }));
            } else if (event.type === 'progress') {
              set((s) => {
                const br = { ...s.batchRename! };
                if (event.status === 'done') {
                  br.done++;
                  br.results = [...br.results, { sessionId: event.sessionId, title: event.title, status: 'done' }];
                } else if (event.status === 'skipped') {
                  br.results = [...br.results, { sessionId: event.sessionId, title: event.reason, status: 'skipped' }];
                } else {
                  br.failed++;
                  br.results = [...br.results, { sessionId: event.sessionId, status: 'error' }];
                }
                return {
                  batchRename: br,
                  sessions: event.title && event.status === 'done'
                    ? s.sessions.map((sess) => sess.sessionId === event.sessionId ? { ...sess, customTitle: event.title } : sess)
                    : s.sessions,
                };
              });
            } else if (event.type === 'complete') {
              set((s) => ({ batchRename: { ...s.batchRename!, running: false } }));
            }
          } catch {}
        }
      }
    }).catch(() => {
      set((s) => ({ batchRename: s.batchRename ? { ...s.batchRename, running: false } : null }));
    });
  },

  dismissBatchRename: () => set({ batchRename: null }),

  aiScanStatus: null,

  startAiScanPoll: (() => {
    let started = false;
    return () => {
      if (started) return; // prevent duplicate intervals
      started = true;
      let wasRunning = false;
      const poll = async () => {
        try {
          const status = await api.getAiScanStatus();
          // Don't re-show an error the user already dismissed
          if (status.error && status.error === _suppressedAiScanError) return;
          if (status.running) {
            wasRunning = true;
            _suppressedAiScanError = null;
            set({ aiScanStatus: status });
          } else if (wasRunning || status.error) {
            wasRunning = false;
            set({ aiScanStatus: { ...status, running: false } });
            if (!status.error) {
              setTimeout(() => {
                set({ aiScanStatus: null });
                get().loadSessions();
              }, 3000);
            }
          }
        } catch {}
      };
      poll();
      setInterval(poll, 2000);
    };
  })(),

  dismissAiScanError: () => {
    const current = useStore.getState().aiScanStatus;
    if (current?.error) {
      _suppressedAiScanError = current.error;
      api.clearAiScanError().catch(() => {});
    }
    set({ aiScanStatus: null });
  },

  refresh: async () => {
    const result = await api.rescan();
    await Promise.all([get().loadStats(), get().loadProjects()]);
    const { currentProject, searchQuery } = get();
    if (searchQuery) {
      get().doSearch(searchQuery);
    } else if (currentProject) {
      get().loadSessions();
    }
    return result;
  },
}));

function sortSessions(sessions: Session[], field: SortField, order: SortOrder): Session[] {
  return [...sessions].sort((a, b) => {
    // Favorites always first
    if (a.isFavorite && !b.isFavorite) return -1;
    if (!a.isFavorite && b.isFavorite) return 1;

    let cmp = 0;
    if (field === 'modified' || field === 'created') {
      cmp = (a[field] || '').localeCompare(b[field] || '');
    } else {
      cmp = (a[field] || 0) - (b[field] || 0);
    }
    return order === 'desc' ? -cmp : cmp;
  });
}
