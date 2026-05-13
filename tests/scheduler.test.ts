import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs';

vi.mock('fs');
vi.mock('child_process', () => ({
  spawn: vi.fn(() => ({
    stdin: { end: vi.fn() },
    stdout: { on: vi.fn() },
    stderr: { on: vi.fn() },
    on: vi.fn(),
    kill: vi.fn(),
    pid: 12345,
  })),
  exec: vi.fn((_cmd: any, cb: any) => cb && cb(null)),
  execSync: vi.fn(),
}));
vi.mock('node-cron', () => ({
  default: {
    validate: (expr: string) => {
      // Simple validation: 5 fields separated by spaces
      const parts = expr.trim().split(/\s+/);
      return parts.length === 5;
    },
    schedule: vi.fn().mockReturnValue({ stop: vi.fn() }),
  },
}));
vi.mock('../src/services/tmux', () => ({
  hasTmux: vi.fn().mockReturnValue(false),
  executeInTmux: vi.fn().mockReturnValue({ success: true }),
  sessionName: vi.fn((id: string) => `task-${id.slice(0, 8)}`),
  killSession: vi.fn(),
  isAlive: vi.fn().mockReturnValue(false),
  captureOutput: vi.fn().mockReturnValue(''),
}));

describe('scheduler service', () => {
  let scheduler: typeof import('../src/services/scheduler');

  beforeEach(async () => {
    vi.resetModules();
    vi.mocked(fs.existsSync).mockReturnValue(false);
    vi.mocked(fs.readFileSync).mockReturnValue('[]');
    vi.mocked(fs.writeFileSync).mockImplementation(() => {});
    scheduler = await import('../src/services/scheduler');
    scheduler.init();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('init', () => {
    it('loads empty task list when file does not exist', () => {
      expect(scheduler.getTasks()).toEqual([]);
    });

    it('loads existing tasks from file', async () => {
      vi.resetModules();
      const existingTasks = [
        { id: 'task-1', prompt: 'test', scheduleType: 'once', status: 'completed', cron: null, scheduledAt: null, createdAt: '2026-01-01T00:00:00Z', startedAt: null, completedAt: null, skipPermissions: false, openInTerminal: false, workingDirectory: null, model: null, output: null, error: null, lastRunAt: null, runCount: 0, runHistory: [], tmuxSession: null },
      ];
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify(existingTasks));
      vi.mocked(fs.writeFileSync).mockImplementation(() => {});
      scheduler = await import('../src/services/scheduler');
      scheduler.init();
      expect(scheduler.getTasks()).toHaveLength(1);
      expect(scheduler.getTasks()[0].id).toBe('task-1');
    });

    it('marks orphaned running non-cron tasks as failed', async () => {
      vi.resetModules();
      const orphanedTasks = [
        { id: 'orphan-1', prompt: 'stuck', scheduleType: 'immediate', status: 'running', cron: null, scheduledAt: null, createdAt: '2026-01-01T00:00:00Z', startedAt: '2026-01-01T00:00:01Z', completedAt: null, skipPermissions: false, openInTerminal: false, workingDirectory: null, model: null, output: null, error: null, lastRunAt: null, runCount: 0, runHistory: [], tmuxSession: null },
      ];
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify(orphanedTasks));
      vi.mocked(fs.writeFileSync).mockImplementation(() => {});
      scheduler = await import('../src/services/scheduler');
      scheduler.init();
      const task = scheduler.getTask('orphan-1');
      expect(task!.status).toBe('failed');
      expect(task!.error).toContain('Server restarted');
    });
  });

  describe('createTask', () => {
    const future = () => new Date(Date.now() + 600000).toISOString();

    it('creates a scheduled task with correct fields', () => {
      const task = scheduler.createTask({
        prompt: 'run tests',
        scheduleType: 'once',
        scheduledAt: future(),
      });
      expect(task.id).toBeDefined();
      expect(task.prompt).toBe('run tests');
      expect(task.scheduleType).toBe('once');
      expect(task.status).toBe('pending');
      expect(task.createdAt).toBeDefined();
    });

    it('creates a cron task', () => {
      const task = scheduler.createTask({
        prompt: 'daily check',
        scheduleType: 'cron',
        cron: '0 9 * * *',
      });
      expect(task.cron).toBe('0 9 * * *');
      expect(task.scheduleType).toBe('cron');
    });

    it('creates a one-time scheduled task', () => {
      const f = future();
      const task = scheduler.createTask({
        prompt: 'later',
        scheduleType: 'once',
        scheduledAt: f,
      });
      expect(task.scheduleType).toBe('once');
      expect(task.scheduledAt).toBe(f);
    });

    it('persists to file', () => {
      scheduler.createTask({ prompt: 'save me', scheduleType: 'once', scheduledAt: future() });
      expect(fs.writeFileSync).toHaveBeenCalledWith(
        expect.stringContaining('scheduled-tasks.json'),
        expect.any(String),
      );
    });

    it('sets default values', () => {
      const task = scheduler.createTask({ prompt: 'test', scheduleType: 'once', scheduledAt: future() });
      expect(task.skipPermissions).toBe(false);
      expect(task.openInTerminal).toBe(false);
      expect(task.workingDirectory).toBeNull();
      expect(task.model).toBeNull();
      expect(task.output).toBeNull();
      expect(task.error).toBeNull();
      expect(task.runCount).toBe(0);
      expect(task.runHistory).toEqual([]);
    });
  });

  describe('getTask', () => {
    it('returns task by id', () => {
      const created = scheduler.createTask({ prompt: 'find me', scheduleType: 'once', scheduledAt: new Date(Date.now() + 600000).toISOString() });
      const found = scheduler.getTask(created.id);
      expect(found).toBeDefined();
      expect(found!.prompt).toBe('find me');
    });

    it('returns undefined for unknown id', () => {
      expect(scheduler.getTask('nonexistent')).toBeUndefined();
    });
  });

  describe('deleteTask', () => {
    it('removes task from list', () => {
      const task = scheduler.createTask({ prompt: 'delete me', scheduleType: 'once', scheduledAt: new Date(Date.now() + 600000).toISOString() });
      expect(scheduler.deleteTask(task.id)).toBe(true);
      expect(scheduler.getTask(task.id)).toBeUndefined();
    });

    it('returns false for unknown id', () => {
      expect(scheduler.deleteTask('unknown')).toBe(false);
    });

    it('persists after deletion', () => {
      const task = scheduler.createTask({ prompt: 'x', scheduleType: 'once', scheduledAt: new Date(Date.now() + 600000).toISOString() });
      const writeCount = vi.mocked(fs.writeFileSync).mock.calls.length;
      scheduler.deleteTask(task.id);
      expect(vi.mocked(fs.writeFileSync).mock.calls.length).toBeGreaterThan(writeCount);
    });
  });

  describe('updateTask', () => {
    it('updates task fields', () => {
      const task = scheduler.createTask({ prompt: 'original', scheduleType: 'once', scheduledAt: new Date(Date.now() + 60000).toISOString() });
      const updated = scheduler.updateTask(task.id, { prompt: 'updated' });
      expect(updated).not.toBeNull();
      expect(updated!.prompt).toBe('updated');
    });

    it('returns null for unknown task', () => {
      expect(scheduler.updateTask('fake', { prompt: 'x' })).toBeNull();
    });

    it('resets completed task to pending', () => {
      const task = scheduler.createTask({ prompt: 'test', scheduleType: 'once', scheduledAt: new Date(Date.now() + 60000).toISOString() });
      // Simulate completion
      (task as any).status = 'completed';
      (task as any).output = 'done';
      const updated = scheduler.updateTask(task.id, { prompt: 'retry' });
      expect(updated!.status).toBe('pending');
      expect(updated!.output).toBeNull();
    });
  });

  describe('cancelTask', () => {
    it('sets status to cancelled', () => {
      const task = scheduler.createTask({ prompt: 'cancel me', scheduleType: 'once', scheduledAt: new Date(Date.now() + 60000).toISOString() });
      expect(scheduler.cancelTask(task.id)).toBe(true);
      expect(scheduler.getTask(task.id)!.status).toBe('cancelled');
      expect(scheduler.getTask(task.id)!.completedAt).toBeDefined();
    });

    it('returns false for unknown task', () => {
      expect(scheduler.cancelTask('fake')).toBe(false);
    });
  });

  describe('validateCron', () => {
    it('accepts valid 5-field expressions', () => {
      expect(scheduler.validateCron('*/5 * * * *')).toBe(true);
      expect(scheduler.validateCron('0 9 * * 1-5')).toBe(true);
      expect(scheduler.validateCron('30 14 1 * *')).toBe(true);
    });

    it('rejects invalid expressions', () => {
      expect(scheduler.validateCron('invalid')).toBe(false);
      expect(scheduler.validateCron('* * *')).toBe(false);
      expect(scheduler.validateCron('')).toBe(false);
    });
  });

  describe('runNow', () => {
    it('returns false for unknown task', () => {
      expect(scheduler.runNow('nonexistent')).toBe(false);
    });

    it('returns true for pending task and triggers execution', () => {
      const future = new Date(Date.now() + 600000).toISOString();
      const task = scheduler.createTask({ prompt: 'run now', scheduleType: 'once', scheduledAt: future });
      // runNow calls executeTask which calls spawn
      const result = scheduler.runNow(task.id);
      expect(result).toBe(true);
    });

    it('returns false for completed task', () => {
      const future = new Date(Date.now() + 600000).toISOString();
      const task = scheduler.createTask({ prompt: 'done', scheduleType: 'once', scheduledAt: future });
      (task as any).status = 'completed';
      expect(scheduler.runNow(task.id)).toBe(false);
    });
  });

  describe('getLiveOutput', () => {
    it('returns null for unknown task', () => {
      expect(scheduler.getLiveOutput('fake')).toBeNull();
    });
  });
});
