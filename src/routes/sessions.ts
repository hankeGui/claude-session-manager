import { Router, Request, Response } from 'express';
import { exec, execSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import * as scanner from '../services/scanner';
import { readSessionMessages } from '../services/session-reader';
import { deleteSession, batchDelete } from '../services/session-cleaner';
import { hasTmux } from '../services/tmux';

const PREFS_FILE = path.join(__dirname, '..', '..', 'user-preferences.json');

function loadPrefs(): Record<string, any> {
  try { return JSON.parse(fs.readFileSync(PREFS_FILE, 'utf-8')); }
  catch { return {}; }
}

function savePrefs(prefs: Record<string, any>): void {
  fs.writeFileSync(PREFS_FILE, JSON.stringify(prefs, null, 2));
}

const router = Router();

router.get('/:sessionId/messages', async (req: Request, res: Response) => {
  const { sessionId } = req.params;
  const limit = parseInt(req.query.limit as string) || 100;
  const offset = parseInt(req.query.offset as string) || 0;

  const found = scanner.getSessionById(sessionId);
  if (!found) {
    return res.status(404).json({ error: 'Session not found' });
  }

  const { session, project } = found;
  const result = await readSessionMessages(session.dirName, sessionId, { limit, offset });

  res.json({
    ...result,
    session: {
      sessionId: session.sessionId,
      firstPrompt: session.firstPrompt,
      summary: session.summary,
      messageCount: session.messageCount,
      created: session.created,
      modified: session.modified,
      gitBranch: session.gitBranch,
      diskSize: session.diskSize,
    },
    project: {
      dirName: project.dirName,
      displayName: project.displayName,
      projectPath: project.projectPath,
    },
  });
});

router.delete('/:sessionId', async (req: Request, res: Response) => {
  const { sessionId } = req.params;
  const result = await deleteSession(sessionId);
  if (!result.success) {
    return res.status(404).json({ error: result.error });
  }
  res.json(result);
});

router.post('/batch-delete', async (req: Request, res: Response) => {
  const { sessionIds } = req.body;
  if (!Array.isArray(sessionIds) || sessionIds.length === 0) {
    return res.status(400).json({ error: 'sessionIds array required' });
  }
  const result = await batchDelete(sessionIds);
  res.json(result);
});

// Batch AI rename with SSE progress streaming
router.post('/batch-rename', (req: Request, res: Response) => {
  const { sessionIds } = req.body;
  if (!Array.isArray(sessionIds) || sessionIds.length === 0) {
    return res.status(400).json({ error: 'sessionIds array required' });
  }

  // Filter: skip sessions that already have a custom title or are empty
  const toRename: { sessionId: string; project: any }[] = [];
  for (const id of sessionIds) {
    const found = scanner.getSessionById(id);
    if (!found) continue;
    const { session, project } = found;
    if (session.customTitle) continue; // already renamed
    if (session.isEmpty) continue; // empty session
    toRename.push({ sessionId: id, project });
  }

  // SSE headers
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  const total = toRename.length;
  let done = 0;
  let failed = 0;

  if (total === 0) {
    res.write(`data: ${JSON.stringify({ type: 'complete', done: 0, failed: 0, skipped: sessionIds.length, total: 0 })}\n\n`);
    res.end();
    return;
  }

  res.write(`data: ${JSON.stringify({ type: 'start', total, skipped: sessionIds.length - total })}\n\n`);

  // Process sequentially to avoid overloading Claude
  let idx = 0;
  function next() {
    if (idx >= toRename.length) {
      res.write(`data: ${JSON.stringify({ type: 'complete', done, failed, skipped: sessionIds.length - total, total })}\n\n`);
      res.end();
      return;
    }

    const { sessionId, project } = toRename[idx++];
    const cwd = project.projectPath || process.env.HOME;
    const prompt = 'Based on the conversation history in this session, generate a short descriptive title (under 50 characters, in the same language as the conversation). Output ONLY the title text, nothing else.';
    const cmd = `claude -p "${prompt.replace(/"/g, '\\"')}" --resume ${sessionId} --no-session-persistence --bare < /dev/null`;

    exec(cmd, { cwd, timeout: 30000 }, (err, stdout) => {
      if (err || !stdout.trim()) {
        failed++;
        res.write(`data: ${JSON.stringify({ type: 'progress', sessionId, status: 'error', done: done + failed, total })}\n\n`);
      } else {
        const title = stdout.trim().replace(/^["']|["']$/g, '');
        scanner.setTitle(sessionId, title);
        done++;
        res.write(`data: ${JSON.stringify({ type: 'progress', sessionId, status: 'done', title, done: done + failed, total })}\n\n`);
      }
      next();
    });
  }

  next();

  // Clean up on client disconnect
  req.on('close', () => {
    idx = toRename.length; // stop processing
  });
});

router.post('/:sessionId/auto-rename', (req: Request, res: Response) => {
  const { sessionId } = req.params;
  const found = scanner.getSessionById(sessionId);
  if (!found) {
    return res.status(404).json({ error: 'Session not found' });
  }

  const { project } = found;
  const cwd = project.projectPath || process.env.HOME;
  const prompt = 'Based on the conversation history in this session, generate a short descriptive title (under 50 characters, in the same language as the conversation). Output ONLY the title text, nothing else.';
  const cmd = `claude -p "${prompt.replace(/"/g, '\\"')}" --resume ${sessionId} --no-session-persistence --bare < /dev/null`;

  exec(cmd, { cwd, timeout: 30000 }, (err, stdout, stderr) => {
    if (err) {
      return res.status(500).json({ error: 'Claude command failed', detail: stderr || err.message });
    }
    const title = stdout.trim().replace(/^["']|["']$/g, '');
    if (!title) {
      return res.status(500).json({ error: 'Claude returned empty title' });
    }
    scanner.setTitle(sessionId, title);
    res.json({ success: true, sessionId, title });
  });
});

router.put('/:sessionId/title', (req: Request, res: Response) => {
  const { sessionId } = req.params;
  const { title } = req.body;

  const found = scanner.getSessionById(sessionId);
  if (!found) {
    return res.status(404).json({ error: 'Session not found' });
  }

  scanner.setTitle(sessionId, title || '');
  res.json({ success: true, sessionId, title: title || '' });
});

router.put('/:sessionId/favorite', (req: Request, res: Response) => {
  const { sessionId } = req.params;
  const { isFavorite } = req.body;

  const found = scanner.getSessionById(sessionId);
  if (!found) {
    return res.status(404).json({ error: 'Session not found' });
  }

  scanner.setFavorite(sessionId, !!isFavorite);
  res.json({ success: true, sessionId, isFavorite: !!isFavorite });
});

router.post('/:sessionId/resume', (req: Request, res: Response) => {
  const { sessionId } = req.params;
  const found = scanner.getSessionById(sessionId);
  if (!found) {
    return res.status(404).json({ error: 'Session not found' });
  }

  const { project } = found;
  const { skipPermissions, terminal: terminalChoice } = req.body || {};
  const cwd = project.projectPath || process.env.HOME;
  const flags = skipPermissions ? ' --dangerously-skip-permissions' : '';
  const claudeCmd = `cd ${(cwd as string).replace(/"/g, '\\"')} && claude${flags} --resume ${sessionId}`;

  // Determine terminal to use
  const terminal = terminalChoice || loadPrefs().terminal || 'auto';

  // tmux mode
  if (terminal === 'tmux') {
    if (!hasTmux()) {
      return res.status(400).json({ error: 'tmux is not installed' });
    }
    const name = `resume-${sessionId.slice(0, 8)}`;
    try {
      execSync(`tmux has-session -t ${name}`, { stdio: 'ignore' });
      // Session exists, attach via osascript
      openTerminalWithCmd(`tmux attach -t ${name}`);
    } catch {
      // Create new tmux session
      execSync(`tmux new-session -d -s ${name} -c '${(cwd as string).replace(/'/g, "'\\''")}'`, { stdio: 'ignore' });
      execSync(`tmux send-keys -t ${name} '${claudeCmd.replace(/'/g, "'\\''")}' Enter`, { stdio: 'ignore' });
      openTerminalWithCmd(`tmux attach -t ${name}`);
    }
    return res.json({ success: true, terminal: 'tmux', cwd, sessionId });
  }

  // osascript mode (iTerm / Terminal.app)
  const termApp = terminal === 'auto'
    ? (process.env.TERM_PROGRAM || 'Apple_Terminal')
    : terminal;

  let script: string;
  if (termApp.includes('iTerm')) {
    script = `
      tell application "iTerm2"
        activate
        set newWindow to (create window with default profile)
        tell current session of newWindow
          write text "${claudeCmd}"
        end tell
      end tell
    `;
  } else {
    script = `
      tell application "Terminal"
        activate
        do script "${claudeCmd}"
      end tell
    `;
  }

  exec(`osascript -e '${script.replace(/'/g, "'\\''")}'`, (err) => {
    if (err) {
      return res.status(500).json({ error: 'Failed to open terminal', detail: err.message });
    }
    res.json({ success: true, terminal: termApp, cwd, sessionId });
  });
});

function openTerminalWithCmd(cmd: string): void {
  const terminal = process.env.TERM_PROGRAM || 'Apple_Terminal';
  let script: string;
  if (terminal.includes('iTerm')) {
    script = `
      tell application "iTerm2"
        activate
        set newWindow to (create window with default profile)
        tell current session of newWindow
          write text "${cmd.replace(/"/g, '\\"')}"
        end tell
      end tell
    `;
  } else {
    script = `
      tell application "Terminal"
        activate
        do script "${cmd.replace(/"/g, '\\"')}"
      end tell
    `;
  }
  exec(`osascript -e '${script.replace(/'/g, "'\\''")}'`);
}

// User preferences
router.get('/preferences', (_req: Request, res: Response) => {
  const prefs = loadPrefs();
  res.json({ terminal: prefs.terminal || null, tmuxAvailable: hasTmux() });
});

router.put('/preferences', (req: Request, res: Response) => {
  const { terminal } = req.body;
  const prefs = loadPrefs();
  prefs.terminal = terminal;
  savePrefs(prefs);
  res.json({ success: true, terminal });
});

export default router;
