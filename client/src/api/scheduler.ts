export interface ScheduledTask {
  id: string;
  prompt: string;
  scheduleType: 'immediate' | 'once' | 'cron';
  scheduledAt: string | null;
  cron: string | null;
  createdAt: string;
  startedAt: string | null;
  completedAt: string | null;
  status: 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';
  skipPermissions: boolean;
  openInTerminal: boolean;
  workingDirectory: string | null;
  model: string | null;
  output: string | null;
  error: string | null;
  lastRunAt: string | null;
  runCount: number;
  runHistory: string[];
  tmuxSession: string | null;
}

export interface CreateTaskPayload {
  prompt: string;
  scheduleType: 'immediate' | 'once' | 'cron';
  scheduledAt?: string | null;
  cron?: string | null;
  skipPermissions?: boolean;
  openInTerminal?: boolean;
  workingDirectory?: string | null;
  model?: string | null;
}

async function request<T>(url: string, options?: RequestInit): Promise<T> {
  const res = await fetch(url, options);
  if (!res.ok) {
    const data = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(data.error || res.statusText);
  }
  return res.json();
}

export const schedulerApi = {
  getTasks: () => request<{ tasks: ScheduledTask[] }>('/api/scheduler/tasks'),

  createTask: (payload: CreateTaskPayload) =>
    request<ScheduledTask>('/api/scheduler/tasks', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    }),

  updateTask: (id: string, payload: Partial<CreateTaskPayload>) =>
    request<ScheduledTask>(`/api/scheduler/tasks/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    }),

  deleteTask: (id: string) =>
    request<{ success: boolean }>(`/api/scheduler/tasks/${id}`, { method: 'DELETE' }),

  runNow: (id: string) =>
    request<{ success: boolean }>(`/api/scheduler/tasks/${id}/run`, { method: 'POST' }),

  cancelTask: (id: string) =>
    request<{ success: boolean }>(`/api/scheduler/tasks/${id}/cancel`, { method: 'POST' }),

  getOutput: (id: string) =>
    request<{ status: string; stdout: string; stderr: string }>(`/api/scheduler/tasks/${id}/output`),

  validateCron: (expression: string) =>
    request<{ valid: boolean }>('/api/scheduler/validate-cron', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ expression }),
    }),

  generateCron: (text: string) =>
    request<{ cron: string; valid: boolean }>('/api/scheduler/generate-cron', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text }),
    }),

  getCapabilities: () =>
    request<{ tmux: boolean }>('/api/scheduler/capabilities'),

  attachTmux: (id: string) =>
    request<{ success: boolean }>(`/api/scheduler/tasks/${id}/attach`, { method: 'POST' }),
};
