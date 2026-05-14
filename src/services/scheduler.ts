import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { spawn, exec, ChildProcess } from 'child_process';
import cron, { ScheduledTask as CronScheduledTask } from 'node-cron';
import type { ScheduledTask } from '../types';
import { hasTmux, executeInTmux, sessionName, killSession, isAlive, captureOutput } from './tmux';

const DATA_FILE = path.join(process.cwd(), 'scheduled-tasks.json');

let tasks: ScheduledTask[] = [];
const timers = new Map<string, NodeJS.Timeout>();
const cronJobs = new Map<string, CronScheduledTask>();
const processes = new Map<string, ChildProcess>();
const liveOutput = new Map<string, { stdout: string; stderr: string }>();

function load(): ScheduledTask[] {
  if (!fs.existsSync(DATA_FILE)) return [];
  try {
    return JSON.parse(fs.readFileSync(DATA_FILE, 'utf-8'));
  } catch {
    return [];
  }
}

function save() {
  fs.writeFileSync(DATA_FILE, JSON.stringify(tasks, null, 2));
}

const SYSTEM_SUFFIX = `IMPORTANT: You are running as an automated scheduled task with NO human in the loop. Never ask the user questions or wait for input. Make all decisions autonomously. If information is missing, use your best judgment or skip that step. Complete the task fully without any interaction.`;

function buildArgs(task: ScheduledTask): string[] {
  const args: string[] = ['-p', task.prompt, '--append-system-prompt', SYSTEM_SUFFIX];
  if (task.skipPermissions) args.push('--dangerously-skip-permissions');
  if (task.model) args.push('--model', task.model);
  if (task.workingDirectory) args.push('--add-dir', task.workingDirectory);
  return args;
}

function executeInTerminal(task: ScheduledTask) {
  const args = buildArgs(task);
  const cmd = `claude ${args.map(a => a.includes(' ') ? `"${a}"` : a).join(' ')}`;
  const cwd = task.workingDirectory && fs.existsSync(task.workingDirectory)
    ? task.workingDirectory
    : process.cwd();

  if (hasTmux()) {
    executeInTerminalViaTmux(task, cmd, cwd);
  } else {
    executeInTerminalViaOsascript(task, cmd, cwd);
  }
}

function executeInTerminalViaTmux(task: ScheduledTask, cmd: string, cwd: string) {
  const now = new Date().toISOString();
  const result = executeInTmux(task, cmd, cwd);

  task.startedAt = task.startedAt || now;
  task.lastRunAt = now;
  task.runCount = (task.runCount || 0) + 1;
  if (!task.runHistory) task.runHistory = [];
  task.runHistory.push(now);
  if (task.runHistory.length > 10) task.runHistory = task.runHistory.slice(-10);
  task.tmuxSession = sessionName(task.id);

  if (result.success) {
    if (task.scheduleType === 'cron') {
      task.status = 'running';
    } else {
      task.status = 'running'; // tmux tasks stay running until session exits
    }
    task.error = null;
  } else {
    if (task.scheduleType !== 'cron') {
      task.status = 'failed';
      task.completedAt = now;
    }
    task.error = result.error || 'Failed to start tmux session';
  }
  save();
}

function executeInTerminalViaOsascript(task: ScheduledTask, cmd: string, cwd: string) {
  const fullCmd = `cd ${cwd.replace(/"/g, '\\"')} && ${cmd}`;
  const terminal = process.env.TERM_PROGRAM || 'Apple_Terminal';

  let script: string;
  if (terminal.includes('iTerm')) {
    script = `
      tell application "iTerm2"
        activate
        set newWindow to (create window with default profile)
        tell current session of newWindow
          write text "${fullCmd.replace(/"/g, '\\"')}"
        end tell
      end tell
    `;
  } else {
    script = `
      tell application "Terminal"
        activate
        do script "${fullCmd.replace(/"/g, '\\"')}"
      end tell
    `;
  }

  exec(`osascript -e '${script.replace(/'/g, "'\\''")}'`, (err) => {
    const now = new Date().toISOString();
    task.startedAt = task.startedAt || now;
    task.lastRunAt = now;
    task.runCount = (task.runCount || 0) + 1;
    if (!task.runHistory) task.runHistory = [];
    task.runHistory.push(now);
    if (task.runHistory.length > 10) task.runHistory = task.runHistory.slice(-10);

    if (err) {
      if (task.scheduleType !== 'cron') {
        task.status = 'failed';
        task.completedAt = now;
      }
      task.error = `Failed to open terminal: ${err.message}`;
    } else {
      if (task.scheduleType === 'cron') {
        task.status = 'running';
      } else {
        task.status = 'completed';
        task.completedAt = now;
      }
      task.output = `Opened in ${terminal}`;
    }
    save();
  });
}

function executeTask(taskId: string) {
  const task = tasks.find(t => t.id === taskId);
  if (!task || task.status === 'cancelled') return;

  if (task.openInTerminal) {
    executeInTerminal(task);
    return;
  }

  const isCron = task.scheduleType === 'cron';

  if (!isCron) {
    task.status = 'running';
  }
  task.startedAt = new Date().toISOString();
  task.lastRunAt = task.startedAt;
  task.output = '';
  task.error = null;
  save();

  const args = buildArgs(task);
  const opts: any = { stdio: ['pipe', 'pipe', 'pipe'] };
  if (task.workingDirectory && fs.existsSync(task.workingDirectory)) {
    opts.cwd = task.workingDirectory;
  }

  const child = spawn('claude', args, opts);
  processes.set(taskId, child);
  liveOutput.set(taskId, { stdout: '', stderr: '' });
  child.stdin?.end();

  child.stdout?.on('data', (data: Buffer) => {
    const live = liveOutput.get(taskId);
    if (live) live.stdout += data.toString();
  });
  child.stderr?.on('data', (data: Buffer) => {
    const live = liveOutput.get(taskId);
    if (live) live.stderr += data.toString();
  });

  child.on('close', (code) => {
    processes.delete(taskId);
    const live = liveOutput.get(taskId);
    liveOutput.delete(taskId);
    const now = new Date().toISOString();
    task.completedAt = now;
    task.output = live?.stdout || null;
    task.error = live?.stderr || null;
    task.runCount = (task.runCount || 0) + 1;
    if (!task.runHistory) task.runHistory = [];
    task.runHistory.push(now);
    if (task.runHistory.length > 10) task.runHistory = task.runHistory.slice(-10);

    if (isCron) {
      task.status = 'running';
    } else {
      task.status = code === 0 ? 'completed' : 'failed';
      if (code !== 0 && !task.error) task.error = `Process exited with code ${code}`;
    }
    save();
  });

  child.on('error', (err) => {
    processes.delete(taskId);
    liveOutput.delete(taskId);
    const now = new Date().toISOString();
    task.completedAt = now;
    task.error = err.message;
    task.runCount = (task.runCount || 0) + 1;
    if (!task.runHistory) task.runHistory = [];
    task.runHistory.push(now);
    if (task.runHistory.length > 10) task.runHistory = task.runHistory.slice(-10);
    if (!isCron) {
      task.status = 'failed';
    }
    save();
  });
}

function scheduleOnce(task: ScheduledTask) {
  if (!task.scheduledAt) return;
  const delay = new Date(task.scheduledAt).getTime() - Date.now();
  if (delay <= 0) {
    executeTask(task.id);
  } else {
    const timer = setTimeout(() => {
      timers.delete(task.id);
      executeTask(task.id);
    }, delay);
    timers.set(task.id, timer);
  }
}

function scheduleCron(task: ScheduledTask) {
  if (!task.cron || !cron.validate(task.cron)) return;

  const job = cron.schedule(task.cron, () => {
    executeTask(task.id);
  });
  cronJobs.set(task.id, job);
  task.status = 'running';
  save();
}

// Public API

export function init() {
  tasks = load();
  for (const task of tasks) {
    if (task.status === 'pending') {
      if (task.scheduleType === 'once' && task.scheduledAt) {
        scheduleOnce(task);
      }
    } else if (task.status === 'running' && task.scheduleType === 'cron') {
      // Re-register cron job
      scheduleCron(task);
    } else if (task.status === 'running' && task.scheduleType !== 'cron') {
      // Orphaned running task from server crash
      task.status = 'failed';
      task.error = 'Server restarted during execution';
      task.completedAt = new Date().toISOString();
    }
  }
  save();
}

export function getTasks(): ScheduledTask[] {
  return tasks;
}

export function getTask(id: string): ScheduledTask | undefined {
  return tasks.find(t => t.id === id);
}

export function createTask(data: {
  prompt: string;
  scheduleType: 'immediate' | 'once' | 'cron';
  scheduledAt?: string | null;
  cron?: string | null;
  skipPermissions?: boolean;
  openInTerminal?: boolean;
  workingDirectory?: string | null;
  model?: string | null;
}): ScheduledTask {
  const task: ScheduledTask = {
    id: crypto.randomUUID(),
    prompt: data.prompt,
    scheduleType: data.scheduleType,
    scheduledAt: data.scheduledAt || null,
    cron: data.cron || null,
    createdAt: new Date().toISOString(),
    startedAt: null,
    completedAt: null,
    status: 'pending',
    skipPermissions: data.skipPermissions || false,
    openInTerminal: data.openInTerminal || false,
    workingDirectory: data.workingDirectory || null,
    model: data.model || null,
    output: null,
    error: null,
    lastRunAt: null,
    runCount: 0,
    runHistory: [],
    tmuxSession: null,
  };

  tasks.push(task);
  save();

  if (data.scheduleType === 'immediate') {
    executeTask(task.id);
  } else if (data.scheduleType === 'once') {
    scheduleOnce(task);
  } else if (data.scheduleType === 'cron') {
    scheduleCron(task);
  }

  return task;
}

export function updateTask(id: string, data: Partial<{
  prompt: string;
  scheduleType: 'immediate' | 'once' | 'cron';
  scheduledAt: string | null;
  cron: string | null;
  skipPermissions: boolean;
  openInTerminal: boolean;
  workingDirectory: string | null;
  model: string | null;
}>): ScheduledTask | null {
  const task = tasks.find(t => t.id === id);
  if (!task) return null;
  // Cannot edit a task that is currently executing (non-cron running)
  if (task.status === 'running' && task.scheduleType !== 'cron') return null;

  // Stop existing schedule/cron
  const timer = timers.get(id);
  if (timer) { clearTimeout(timer); timers.delete(id); }
  const job = cronJobs.get(id);
  if (job) { job.stop(); cronJobs.delete(id); }

  Object.assign(task, data);

  // Reset status for completed/failed/cancelled tasks so they can be re-scheduled
  if (task.status === 'completed' || task.status === 'failed' || task.status === 'cancelled') {
    task.status = 'pending';
    task.output = null;
    task.error = null;
    task.startedAt = null;
    task.completedAt = null;
  }

  save();

  // Re-schedule based on new type
  if (task.scheduleType === 'once' && task.scheduledAt) {
    task.status = 'pending';
    scheduleOnce(task);
  } else if (task.scheduleType === 'cron' && task.cron) {
    scheduleCron(task);
  } else if (task.scheduleType === 'immediate') {
    executeTask(task.id);
  }

  save();
  return task;
}

export function deleteTask(id: string): boolean {
  const idx = tasks.findIndex(t => t.id === id);
  if (idx === -1) return false;

  const timer = timers.get(id);
  if (timer) { clearTimeout(timer); timers.delete(id); }
  const job = cronJobs.get(id);
  if (job) { job.stop(); cronJobs.delete(id); }
  const proc = processes.get(id);
  if (proc) { proc.kill(); processes.delete(id); }

  tasks.splice(idx, 1);
  save();
  return true;
}

export function runNow(id: string): boolean {
  const task = tasks.find(t => t.id === id);
  if (!task || (task.status !== 'pending' && !(task.status === 'running' && task.scheduleType === 'cron'))) return false;

  // For cron tasks, just trigger an immediate run without stopping the cron
  executeTask(id);
  return true;
}

export function cancelTask(id: string): boolean {
  const task = tasks.find(t => t.id === id);
  if (!task) return false;

  const timer = timers.get(id);
  if (timer) { clearTimeout(timer); timers.delete(id); }
  const job = cronJobs.get(id);
  if (job) { job.stop(); cronJobs.delete(id); }
  const proc = processes.get(id);
  if (proc) { proc.kill(); processes.delete(id); }
  // Kill tmux session if exists
  if (task.tmuxSession) {
    killSession(task.tmuxSession);
    task.tmuxSession = null;
  }

  task.status = 'cancelled';
  task.completedAt = new Date().toISOString();
  save();
  return true;
}

export function getLiveOutput(id: string): { stdout: string; stderr: string } | null {
  // Try in-process live output first
  const live = liveOutput.get(id);
  if (live) return live;

  // Try tmux capture
  const task = tasks.find(t => t.id === id);
  if (task?.tmuxSession && isAlive(task.tmuxSession)) {
    return { stdout: captureOutput(task.tmuxSession), stderr: '' };
  }

  return null;
}

export function validateCron(expression: string): boolean {
  return cron.validate(expression);
}
