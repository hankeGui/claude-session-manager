import { describe, it, expect, beforeEach, vi } from 'vitest';
import { useStore } from './index';

// Mock the API
vi.mock('../api', () => ({
  api: {
    getStats: vi.fn().mockResolvedValue({ totalProjects: 2, totalSessions: 10, emptySessions: 3 }),
    getProjects: vi.fn().mockResolvedValue({
      projects: [
        { dirName: 'proj-1', displayName: '~/proj-1', sessionCount: 5, emptyCount: 1, totalMessages: 50, newestSession: '2026-01-01' },
        { dirName: 'proj-2', displayName: '~/proj-2', sessionCount: 5, emptyCount: 2, totalMessages: 30, newestSession: '2026-01-02' },
      ],
    }),
    getSessions: vi.fn().mockResolvedValue({
      sessions: [
        { sessionId: 's1', dirName: 'proj-1', customTitle: 'Test', summary: null, firstPrompt: 'hello', messageCount: 5, created: '2026-01-01', modified: '2026-01-02', gitBranch: 'main', diskSize: 1024, isEmpty: false, emptyReason: null },
        { sessionId: 's2', dirName: 'proj-1', customTitle: null, summary: null, firstPrompt: null, messageCount: 0, created: '2026-01-01', modified: '2026-01-01', gitBranch: null, diskSize: 100, isEmpty: true, emptyReason: 'No conversation' },
      ],
      projectPath: '/home/user/proj-1',
      displayName: '~/proj-1',
    }),
    search: vi.fn().mockResolvedValue({ results: [], total: 0 }),
    deepSearch: vi.fn().mockResolvedValue({ results: [], total: 0, aiMatched: 0 }),
    deleteSession: vi.fn().mockResolvedValue({ success: true, sessionId: 's1' }),
    batchDelete: vi.fn().mockResolvedValue({ deleted: 1, failed: 0 }),
    setTitle: vi.fn().mockResolvedValue({ success: true, title: 'New Title' }),
    autoRename: vi.fn().mockResolvedValue({ success: true, title: 'AI Title' }),
    resume: vi.fn().mockResolvedValue({ success: true }),
  },
}));

describe('Store', () => {
  beforeEach(() => {
    useStore.setState({
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
      aiTask: null,
      aiTaskMinimized: false,
    });
  });

  describe('loadStats', () => {
    it('fetches and stores stats', async () => {
      await useStore.getState().loadStats();
      expect(useStore.getState().stats).toEqual({ totalProjects: 2, totalSessions: 10, emptySessions: 3 });
    });
  });

  describe('loadProjects', () => {
    it('fetches and stores projects', async () => {
      await useStore.getState().loadProjects();
      expect(useStore.getState().projects).toHaveLength(2);
      expect(useStore.getState().projects[0].dirName).toBe('proj-1');
    });
  });

  describe('loadSessions', () => {
    it('loads sessions for a project', async () => {
      useStore.setState({ currentProject: 'proj-1' });
      await useStore.getState().loadSessions();
      expect(useStore.getState().sessions).toHaveLength(2);
    });

    it('clears selection when loading', async () => {
      useStore.setState({ currentProject: 'proj-1', selected: new Set(['s1']) });
      await useStore.getState().loadSessions();
      expect(useStore.getState().selected.size).toBe(0);
    });
  });

  describe('setCurrentProject', () => {
    it('sets project and clears search', () => {
      useStore.setState({ searchQuery: 'test', selected: new Set(['s1']) });
      useStore.getState().setCurrentProject('proj-2');
      expect(useStore.getState().currentProject).toBe('proj-2');
      expect(useStore.getState().searchQuery).toBe('');
      expect(useStore.getState().selected.size).toBe(0);
    });
  });

  describe('sorting', () => {
    it('setSortField updates field', () => {
      useStore.getState().setSortField('created');
      expect(useStore.getState().sortField).toBe('created');
    });

    it('setSortOrder updates order', () => {
      useStore.getState().setSortOrder('asc');
      expect(useStore.getState().sortOrder).toBe('asc');
    });
  });

  describe('selection', () => {
    it('toggleSelect adds and removes', () => {
      useStore.getState().toggleSelect('s1');
      expect(useStore.getState().selected.has('s1')).toBe(true);
      useStore.getState().toggleSelect('s1');
      expect(useStore.getState().selected.has('s1')).toBe(false);
    });

    it('selectAll selects all sessions', () => {
      useStore.setState({ sessions: [{ sessionId: 's1' }, { sessionId: 's2' }] as any });
      useStore.getState().selectAll();
      expect(useStore.getState().selected.size).toBe(2);
    });

    it('selectAll toggles off when all selected', () => {
      useStore.setState({
        sessions: [{ sessionId: 's1' }, { sessionId: 's2' }] as any,
        selected: new Set(['s1', 's2']),
      });
      useStore.getState().selectAll();
      expect(useStore.getState().selected.size).toBe(0);
    });

    it('clearSelection empties set', () => {
      useStore.setState({ selected: new Set(['s1', 's2']) });
      useStore.getState().clearSelection();
      expect(useStore.getState().selected.size).toBe(0);
    });
  });

  describe('setTitle', () => {
    it('updates session title in state', async () => {
      useStore.setState({
        sessions: [{ sessionId: 's1', customTitle: null }] as any,
      });
      await useStore.getState().setTitle('s1', 'New Title');
      expect(useStore.getState().sessions[0].customTitle).toBe('New Title');
    });
  });

  describe('autoRename', () => {
    it('returns title and updates state', async () => {
      useStore.setState({
        sessions: [{ sessionId: 's1', customTitle: null }] as any,
      });
      const title = await useStore.getState().autoRename('s1');
      expect(title).toBe('AI Title');
      expect(useStore.getState().sessions[0].customTitle).toBe('AI Title');
    });
  });

  describe('AI task', () => {
    it('startAiRename sets running task', () => {
      useStore.getState().startAiRename('s1', 'Test Session');
      expect(useStore.getState().aiTask).not.toBeNull();
      expect(useStore.getState().aiTask!.status).toBe('running');
      expect(useStore.getState().aiTask!.sessionId).toBe('s1');
    });

    it('blocks second task while one is running', () => {
      useStore.setState({
        aiTask: { sessionId: 's1', sessionTitle: 'Test', status: 'running' },
      });
      useStore.getState().startAiRename('s2', 'Another');
      expect(useStore.getState().aiTask!.sessionId).toBe('s1'); // unchanged
    });

    it('dismissAiTask clears task', () => {
      useStore.setState({
        aiTask: { sessionId: 's1', sessionTitle: 'Test', status: 'done', result: 'Title' },
      });
      useStore.getState().dismissAiTask();
      expect(useStore.getState().aiTask).toBeNull();
    });

    it('toggleAiTaskMinimized toggles', () => {
      expect(useStore.getState().aiTaskMinimized).toBe(false);
      useStore.getState().toggleAiTaskMinimized();
      expect(useStore.getState().aiTaskMinimized).toBe(true);
    });
  });

  describe('emptyFilter', () => {
    it('sets filter value', () => {
      useStore.getState().setEmptyFilter('true');
      expect(useStore.getState().emptyFilter).toBe('true');
    });
  });

  describe('deleteSession', () => {
    it('removes session from state', async () => {
      useStore.setState({
        sessions: [{ sessionId: 's1' }, { sessionId: 's2' }] as any,
        projects: [],
        stats: null,
      });
      await useStore.getState().deleteSession('s1');
      expect(useStore.getState().sessions).toHaveLength(1);
      expect(useStore.getState().sessions[0].sessionId).toBe('s2');
    });
  });
});
