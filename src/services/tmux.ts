import { spawnSync } from 'child_process';
import type { ScheduledTask } from '../types';

let _hasTmux: boolean | null = null;

export function hasTmux(): boolean {
  if (_hasTmux === null) {
    _hasTmux = spawnSync('which', ['tmux'], { stdio: 'ignore' }).status === 0;
  }
  return _hasTmux;
}

function sanitizeName(name: string): string {
  return name.replace(/[^a-zA-Z0-9_-]/g, '');
}

export function sessionName(taskId: string): string {
  return `task-${sanitizeName(taskId.slice(0, 8))}`;
}

export function isAlive(name: string): boolean {
  return spawnSync('tmux', ['has-session', '-t', sanitizeName(name)], { stdio: 'ignore' }).status === 0;
}

export function captureOutput(name: string, lines = 200): string {
  try {
    const result = spawnSync('tmux', ['capture-pane', '-t', sanitizeName(name), '-p', '-S', `-${lines}`], {
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'ignore'],
    });
    return result.stdout?.trim() || '';
  } catch {
    return '';
  }
}

export function killSession(name: string): boolean {
  return spawnSync('tmux', ['kill-session', '-t', sanitizeName(name)], { stdio: 'ignore' }).status === 0;
}

export function executeInTmux(task: ScheduledTask, cmd: string, cwd: string): { success: boolean; error?: string } {
  const name = sessionName(task.id);
  const alive = isAlive(name);

  if (alive && task.scheduleType === 'cron') {
    // Cron: send interrupt then new command to existing session
    try {
      spawnSync('tmux', ['send-keys', '-t', name, 'C-c'], { stdio: 'ignore' });
      spawnSync('tmux', ['send-keys', '-t', name, '', 'Enter'], { stdio: 'ignore' });
      spawnSync('tmux', ['send-keys', '-t', name, cmd, 'Enter'], { stdio: 'ignore' });
      return { success: true };
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  }

  if (alive && task.scheduleType !== 'cron') {
    return { success: false, error: 'Session already running' };
  }

  // Create new session (shell stays alive after command finishes)
  try {
    spawnSync('tmux', ['new-session', '-d', '-s', name, '-c', cwd], { stdio: 'ignore' });
    spawnSync('tmux', ['send-keys', '-t', name, cmd, 'Enter'], { stdio: 'ignore' });
    return { success: true };
  } catch (err: any) {
    return { success: false, error: err.message };
  }
}
