import { execSync } from 'child_process';
import type { ScheduledTask } from '../types';

let _hasTmux: boolean | null = null;

export function hasTmux(): boolean {
  if (_hasTmux === null) {
    try {
      execSync('which tmux', { stdio: 'ignore' });
      _hasTmux = true;
    } catch {
      _hasTmux = false;
    }
  }
  return _hasTmux;
}

export function sessionName(taskId: string): string {
  return `task-${taskId.slice(0, 8)}`;
}

export function isAlive(name: string): boolean {
  try {
    execSync(`tmux has-session -t ${name}`, { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

export function captureOutput(name: string, lines = 200): string {
  try {
    return execSync(`tmux capture-pane -t ${name} -p -S -${lines}`, {
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'ignore'],
    }).trim();
  } catch {
    return '';
  }
}

export function killSession(name: string): boolean {
  try {
    execSync(`tmux kill-session -t ${name}`, { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

export function executeInTmux(task: ScheduledTask, cmd: string, cwd: string): { success: boolean; error?: string } {
  const name = sessionName(task.id);
  const alive = isAlive(name);

  if (alive && task.scheduleType === 'cron') {
    // Cron: send interrupt then new command to existing session
    try {
      execSync(`tmux send-keys -t ${name} C-c`, { stdio: 'ignore' });
      // Small delay to let the interrupt take effect
      execSync(`tmux send-keys -t ${name} "" Enter`, { stdio: 'ignore' });
      execSync(`tmux send-keys -t ${name} ${shellEscape(cmd)} Enter`, { stdio: 'ignore' });
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
    execSync(`tmux new-session -d -s ${name} -c ${shellEscape(cwd)}`, { stdio: 'ignore' });
    execSync(`tmux send-keys -t ${name} ${shellEscape(cmd)} Enter`, { stdio: 'ignore' });
    return { success: true };
  } catch (err: any) {
    return { success: false, error: err.message };
  }
}

function shellEscape(s: string): string {
  return `'${s.replace(/'/g, "'\\''")}'`;
}
