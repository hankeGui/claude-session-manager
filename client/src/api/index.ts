export interface Project {
  dirName: string;
  displayName: string;
  projectPath: string;
  sessionCount: number;
  emptyCount: number;
  totalMessages: number;
  newestSession: string | null;
}

export interface Session {
  sessionId: string;
  dirName: string;
  customTitle: string | null;
  summary: string | null;
  firstPrompt: string | null;
  messageCount: number;
  created: string;
  modified: string;
  gitBranch: string | null;
  diskSize: number;
  isEmpty: boolean;
  emptyReason: string | null;
  isFavorite: boolean;
  tags: string[];
  projectDisplayName?: string;
  projectPath?: string;
  [key: string]: any;
}

export interface ToolCall {
  name: string;
  input?: Record<string, any>;
}

export interface Message {
  type: 'user' | 'assistant';
  content: string;
  timestamp: string;
  toolCalls?: ToolCall[];
}

export interface Stats {
  totalProjects: number;
  totalSessions: number;
  emptySessions: number;
  oldestSession: string | null;
  newestSession: string | null;
}

async function request<T>(url: string, options?: RequestInit): Promise<T> {
  const res = await fetch(url, options);
  if (!res.ok) {
    const data = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(data.error || res.statusText);
  }
  return res.json();
}

export const api = {
  getStats: () => request<Stats>('/api/stats'),

  getProjects: () => request<{ projects: Project[] }>('/api/projects'),

  getSessions: (dirName: string, params?: { sort?: string; order?: string; empty?: string }) => {
    const qs = new URLSearchParams();
    if (params?.sort) qs.set('sort', params.sort);
    if (params?.order) qs.set('order', params.order);
    if (params?.empty) qs.set('empty', params.empty);
    return request<{ sessions: Session[]; projectPath: string; displayName: string }>(
      `/api/projects/${encodeURIComponent(dirName)}/sessions?${qs}`
    );
  },

  getMessages: (sessionId: string, limit = 500) =>
    request<{
      messages: Message[];
      hasMore: boolean;
      session: Session;
      project: { dirName: string; displayName: string; projectPath: string };
    }>(`/api/sessions/${sessionId}/messages?limit=${limit}`),

  search: (q: string, params?: { project?: string; empty?: string; mode?: string; favorite?: string }) => {
    const qs = new URLSearchParams({ q });
    if (params?.project) qs.set('project', params.project);
    if (params?.empty) qs.set('empty', params.empty);
    if (params?.mode) qs.set('mode', params.mode);
    if (params?.favorite) qs.set('favorite', params.favorite);
    return request<{ results: Session[]; total: number }>(`/api/search?${qs}`);
  },

  deepSearch: (q: string) =>
    request<{ results: Session[]; total: number; aiMatched: number }>('/api/search/deep', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ q }),
    }),

  deleteSession: (sessionId: string) =>
    request<{ success: boolean; sessionId: string }>(`/api/sessions/${sessionId}`, {
      method: 'DELETE',
    }),

  batchDelete: (sessionIds: string[]) =>
    request<{ deleted: number; failed: number }>('/api/sessions/batch-delete', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionIds }),
    }),

  setTitle: (sessionId: string, title: string) =>
    request<{ success: boolean; title: string }>(`/api/sessions/${sessionId}/title`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title }),
    }),

  setFavorite: (sessionId: string, isFavorite: boolean) =>
    request<{ success: boolean; isFavorite: boolean }>(`/api/sessions/${sessionId}/favorite`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ isFavorite }),
    }),

  autoRename: (sessionId: string) =>
    request<{ success: boolean; title: string }>(`/api/sessions/${sessionId}/auto-rename`, {
      method: 'POST',
    }),

  batchRename: (sessionIds: string[]) =>
    fetch('/api/sessions/batch-rename', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionIds }),
    }),

  resume: (sessionId: string, skipPermissions = false, terminal?: string) =>
    request<{ success: boolean; terminal: string; cwd: string }>(`/api/sessions/${sessionId}/resume`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ skipPermissions, terminal }),
    }),

  getPreferences: () =>
    request<{ terminal: string | null; tmuxAvailable: boolean }>('/api/sessions/preferences'),

  setPreferences: (prefs: { terminal: string }) =>
    request<{ success: boolean }>('/api/sessions/preferences', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(prefs),
    }),
};
