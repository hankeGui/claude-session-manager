import { Router, Request, Response } from 'express';
import { spawn, exec } from 'child_process';
import * as scheduler from '../services/scheduler';
import { hasTmux, isAlive, captureOutput, sessionName } from '../services/tmux';

const router = Router();

// List all tasks
router.get('/tasks', (_req: Request, res: Response) => {
  const tasks = scheduler.getTasks();
  res.json({ tasks });
});

// Get single task
router.get('/tasks/:id', (req: Request, res: Response) => {
  const task = scheduler.getTask(req.params.id);
  if (!task) return res.status(404).json({ error: 'Task not found' });
  res.json(task);
});

// Create task
router.post('/tasks', (req: Request, res: Response) => {
  const { prompt, scheduleType, scheduledAt, cron, skipPermissions, openInTerminal, workingDirectory, model } = req.body;
  if (!prompt || !prompt.trim()) {
    return res.status(400).json({ error: 'Prompt is required' });
  }
  if (scheduleType === 'cron' && cron && !scheduler.validateCron(cron)) {
    return res.status(400).json({ error: 'Invalid cron expression' });
  }

  const task = scheduler.createTask({
    prompt: prompt.trim(),
    scheduleType: scheduleType || 'immediate',
    scheduledAt: scheduledAt || null,
    cron: cron || null,
    skipPermissions: !!skipPermissions,
    openInTerminal: !!openInTerminal,
    workingDirectory: workingDirectory || null,
    model: model || null,
  });

  res.status(201).json(task);
});

// Update task
router.put('/tasks/:id', (req: Request, res: Response) => {
  const { prompt, scheduleType, scheduledAt, cron, skipPermissions, openInTerminal, workingDirectory, model } = req.body;
  if (cron && !scheduler.validateCron(cron)) {
    return res.status(400).json({ error: 'Invalid cron expression' });
  }

  const task = scheduler.updateTask(req.params.id, {
    ...(prompt !== undefined && { prompt }),
    ...(scheduleType !== undefined && { scheduleType }),
    ...(scheduledAt !== undefined && { scheduledAt }),
    ...(cron !== undefined && { cron }),
    ...(skipPermissions !== undefined && { skipPermissions }),
    ...(openInTerminal !== undefined && { openInTerminal }),
    ...(workingDirectory !== undefined && { workingDirectory }),
    ...(model !== undefined && { model }),
  });

  if (!task) return res.status(404).json({ error: 'Task not found or not editable' });
  res.json(task);
});

// Delete task
router.delete('/tasks/:id', (req: Request, res: Response) => {
  const success = scheduler.deleteTask(req.params.id);
  if (!success) return res.status(404).json({ error: 'Task not found' });
  res.json({ success: true });
});

// Run now
router.post('/tasks/:id/run', (req: Request, res: Response) => {
  const success = scheduler.runNow(req.params.id);
  if (!success) return res.status(400).json({ error: 'Task not found or not runnable' });
  res.json({ success: true });
});

// Cancel task
router.post('/tasks/:id/cancel', (req: Request, res: Response) => {
  const success = scheduler.cancelTask(req.params.id);
  if (!success) return res.status(400).json({ error: 'Task not found or not cancellable' });
  res.json({ success: true });
});

// Get live output for running task
router.get('/tasks/:id/output', (req: Request, res: Response) => {
  const task = scheduler.getTask(req.params.id);
  if (!task) return res.status(404).json({ error: 'Task not found' });

  // Try tmux capture first
  if (task.tmuxSession && isAlive(task.tmuxSession)) {
    const output = captureOutput(task.tmuxSession);
    return res.json({ status: 'running', stdout: output, stderr: '' });
  }

  const live = scheduler.getLiveOutput(req.params.id);
  if (live) {
    res.json({ status: 'running', stdout: live.stdout, stderr: live.stderr });
  } else {
    res.json({ status: task.status, stdout: task.output || '', stderr: task.error || '' });
  }
});

// Validate cron expression
router.post('/validate-cron', (req: Request, res: Response) => {
  const { expression } = req.body;
  res.json({ valid: scheduler.validateCron(expression || '') });
});

// AI generate cron expression from natural language
router.post('/generate-cron', (req: Request, res: Response) => {
  const { text } = req.body;
  if (!text || !text.trim()) {
    return res.status(400).json({ error: 'Text is required' });
  }

  const prompt = `Convert the following schedule description to a standard 5-field cron expression (minute hour day-of-month month day-of-week). Only output the cron expression, nothing else. No explanation, no markdown, just the expression.\n\nDescription: "${text.trim()}"`;

  const child = spawn('claude', ['-p', prompt], { stdio: ['pipe', 'pipe', 'pipe'] });
  child.stdin?.end();

  let stdout = '';
  let stderr = '';
  child.stdout?.on('data', (d: Buffer) => { stdout += d.toString(); });
  child.stderr?.on('data', (d: Buffer) => { stderr += d.toString(); });

  child.on('close', (code) => {
    const result = stdout.trim();
    // Validate that the output looks like a cron expression (5 fields)
    if (code === 0 && result && /^[\d*\/,\-]+\s+[\d*\/,\-]+\s+[\d*\/,\-]+\s+[\d*\/,\-]+\s+[\d*\/,\-]+$/.test(result)) {
      const valid = scheduler.validateCron(result);
      res.json({ cron: result, valid });
    } else {
      res.status(422).json({ error: 'Could not generate a valid cron expression', raw: result || stderr });
    }
  });

  child.on('error', (err) => {
    res.status(500).json({ error: `Failed to run AI: ${err.message}` });
  });
});

// Server capabilities
router.get('/capabilities', (_req: Request, res: Response) => {
  res.json({ tmux: hasTmux() });
});

// Attach to tmux session (opens terminal with tmux attach)
router.post('/tasks/:id/attach', (req: Request, res: Response) => {
  const task = scheduler.getTask(req.params.id);
  if (!task) return res.status(404).json({ error: 'Task not found' });
  if (!task.tmuxSession) return res.status(400).json({ error: 'No tmux session for this task' });
  if (!isAlive(task.tmuxSession)) return res.status(400).json({ error: 'Session has ended' });

  const cmd = `tmux attach -t ${task.tmuxSession}`;
  const terminal = process.env.TERM_PROGRAM || 'Apple_Terminal';

  let script: string;
  if (terminal.includes('iTerm')) {
    script = `
      tell application "iTerm2"
        activate
        set newWindow to (create window with default profile)
        tell current session of newWindow
          write text "${cmd}"
        end tell
      end tell
    `;
  } else {
    script = `
      tell application "Terminal"
        activate
        do script "${cmd}"
      end tell
    `;
  }

  exec(`osascript -e '${script.replace(/'/g, "'\\''")}'`, (err) => {
    if (err) return res.status(500).json({ error: 'Failed to open terminal' });
    res.json({ success: true });
  });
});

export default router;
