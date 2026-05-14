import { Router, Request, Response } from 'express';
import { exec, execSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import * as scanner from '../services/scanner';
import { readSessionMessages } from '../services/session-reader';
import { deleteSession, batchDelete } from '../services/session-cleaner';
import { hasTmux } from '../services/tmux';
import { getClient } from '../services/ai-client';
import * as aiScanner from '../services/ai-scanner';


const PREFS_FILE = path.join(__dirname, '..', '..', 'user-preferences.json');

// generateTitle is now in ai-scanner.ts
const generateTitle = aiScanner.generateTitle;

function loadPrefs(): Record<string, any> {
  try { return JSON.parse(fs.readFileSync(PREFS_FILE, 'utf-8')); }
  catch { return {}; }
}

function savePrefs(prefs: Record<string, any>): void {
  fs.writeFileSync(PREFS_FILE, JSON.stringify(prefs, null, 2));
}

const router = Router();

router.get('/:sessionId/messages', async (req: Request, res: Response) => {
  const sessionId = req.params.sessionId as string;
  const limit = parseInt(req.query.limit as string) || 100;
  const offset = parseInt(req.query.offset as string) || 0;
  const includeNoise = req.query.noise === '1';

  const found = scanner.getSessionById(sessionId);
  if (!found) {
    return res.status(404).json({ error: 'Session not found' });
  }

  const { session, project } = found;
  const result = await readSessionMessages(session.dirName, sessionId, { limit, offset, includeNoise });

  const aiSummary = aiScanner.getSummary(sessionId);
  res.json({
    ...result,
    session: {
      sessionId: session.sessionId,
      firstPrompt: session.firstPrompt,
      summary: aiSummary || session.summary,
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
  const sessionId = req.params.sessionId as string;
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

  // Filter: skip empty sessions only (frontend handles customTitle pre-check)
  const toRename: { sessionId: string; project: any }[] = [];
  const skippedList: { sessionId: string; reason: string; title?: string }[] = [];
  for (const id of sessionIds) {
    const found = scanner.getSessionById(id);
    if (!found) continue;
    const { session, project } = found;
    if (session.isEmpty) {
      skippedList.push({ sessionId: id, reason: 'empty session' });
      continue;
    }
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

  res.write(`data: ${JSON.stringify({ type: 'start', total, skipped: skippedList.length })}\n\n`);

  // Emit skip events so frontend can show them
  for (const s of skippedList) {
    res.write(`data: ${JSON.stringify({ type: 'progress', sessionId: s.sessionId, status: 'skipped', reason: s.reason, title: s.title || '', done: done + failed, total })}\n\n`);
  }

  // Pause background AI scanner to avoid API overload
  aiScanner.pause();

  let cancelled = false;
  const CONCURRENCY = 3;

  function send(data: any) {
    if (res.destroyed || res.writableEnded) return;
    try {
      res.write(`data: ${JSON.stringify(data)}\n\n`);
    } catch {}
  }

  async function processOne(sessionId: string) {
    try {
      const title = await generateTitle(sessionId);
      if (title) {
        scanner.setTitle(sessionId, title);
        done++;
        send({ type: 'progress', sessionId, status: 'done', title, done: done + failed, total });
      } else {
        failed++;
        send({ type: 'progress', sessionId, status: 'error', done: done + failed, total });
      }
    } catch {
      failed++;
      send({ type: 'progress', sessionId, status: 'error', done: done + failed, total });
    }
  }

  (async () => {
    try {
      for (let i = 0; i < toRename.length; i += CONCURRENCY) {
        if (cancelled) break;
        const batch = toRename.slice(i, i + CONCURRENCY);
        await Promise.allSettled(batch.map(({ sessionId }) => processOne(sessionId)));
      }
      send({ type: 'complete', done, failed, skipped: skippedList.length, total });
      try { res.end(); } catch {}
    } finally {
      aiScanner.resume();
    }
  })();

  res.on('close', () => {
    cancelled = true;
  });
});

router.post('/:sessionId/auto-rename', async (req: Request, res: Response) => {
  const sessionId = req.params.sessionId as string;
  const found = scanner.getSessionById(sessionId);
  if (!found) {
    return res.status(404).json({ error: 'Session not found' });
  }

  if (!getClient()) {
    return res.status(400).json({ error: 'AI not configured', needsConfig: true });
  }

  try {
    const title = await generateTitle(sessionId);
    if (!title) {
      return res.status(500).json({ error: 'AI returned empty title' });
    }
    scanner.setTitle(sessionId, title);
    res.json({ success: true, sessionId, title });
  } catch (err: any) {
    res.status(500).json({ error: 'AI rename failed', detail: err.message });
  }
});

router.post('/:sessionId/regenerate-summary', async (req: Request, res: Response) => {
  const sessionId = req.params.sessionId as string;
  const found = scanner.getSessionById(sessionId);
  if (!found) {
    return res.status(404).json({ error: 'Session not found' });
  }
  if (!getClient()) {
    return res.status(400).json({ error: 'AI not configured', needsConfig: true });
  }
  try {
    const summary = await aiScanner.regenerateSummary(sessionId);
    if (!summary) {
      return res.status(500).json({ error: 'AI returned empty summary' });
    }
    res.json({ success: true, summary });
  } catch (err: any) {
    res.status(500).json({ error: 'Regenerate failed', detail: err.message });
  }
});

router.put('/:sessionId/title', (req: Request, res: Response) => {
  const sessionId = req.params.sessionId as string;
  const { title } = req.body;

  const found = scanner.getSessionById(sessionId);
  if (!found) {
    return res.status(404).json({ error: 'Session not found' });
  }

  scanner.setTitle(sessionId, title || '');
  res.json({ success: true, sessionId, title: title || '' });
});

router.put('/:sessionId/favorite', (req: Request, res: Response) => {
  const sessionId = req.params.sessionId as string;
  const { isFavorite } = req.body;

  const found = scanner.getSessionById(sessionId);
  if (!found) {
    return res.status(404).json({ error: 'Session not found' });
  }

  scanner.setFavorite(sessionId, !!isFavorite);
  res.json({ success: true, sessionId, isFavorite: !!isFavorite });
});

router.post('/:sessionId/resume', (req: Request, res: Response) => {
  const sessionId = req.params.sessionId as string;
  const found = scanner.getSessionById(sessionId);
  if (!found) {
    return res.status(404).json({ error: 'Session not found' });
  }

  const { project } = found;
  const { skipPermissions, terminal: terminalChoice, terminalApp: terminalAppChoice } = req.body || {};
  const cwd = project.projectPath || process.env.HOME;
  const flags = skipPermissions ? ' --dangerously-skip-permissions' : '';
  const claudeCmd = `cd ${(cwd as string).replace(/"/g, '\\"')} && claude${flags} --resume ${sessionId}`;

  // Determine terminal to use
  const terminal = terminalChoice || loadPrefs().terminal || 'auto';

  // tmux mode — create background session, open terminal to attach
  if (terminal === 'tmux') {
    if (!hasTmux()) {
      return res.status(400).json({ error: 'tmux is not installed' });
    }
    const name = `resume-${sessionId.slice(0, 8)}`;
    let alreadyRunning = false;
    try {
      execSync(`tmux has-session -t ${name}`, { stdio: 'ignore' });
      alreadyRunning = true;
    } catch {
      // Create new tmux session in background
      execSync(`tmux new-session -d -s ${name} -c '${(cwd as string).replace(/'/g, "'\\''")}'`, { stdio: 'ignore' });
      execSync(`tmux send-keys -t ${name} '${claudeCmd.replace(/'/g, "'\\''")}; exit' Enter`, { stdio: 'ignore' });
    }

    // Open a terminal window to attach
    const attachCmd = `tmux attach -t ${name}`;
    const termApp = terminalAppChoice || (process.env.TERM_PROGRAM || 'Apple_Terminal');
    let script: string;
    if (termApp.includes('iTerm')) {
      script = `
        tell application "iTerm2"
          activate
          set newWindow to (create window with default profile)
          tell current session of newWindow
            write text "${attachCmd}"
          end tell
        end tell
      `;
    } else {
      script = `
        tell application "Terminal"
          activate
          do script "${attachCmd}"
        end tell
      `;
    }
    exec(`osascript -e '${script.replace(/'/g, "'\\''")}'`);

    return res.json({ success: true, terminal: 'tmux', cwd, sessionId, tmuxSession: name, alreadyRunning });
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
    // Use "do script in (make new tab)" to avoid creating extra windows
    script = `
      tell application "Terminal"
        activate
        if (count of windows) > 0 then
          do script "${cmd.replace(/"/g, '\\"')}" in front window
        else
          do script "${cmd.replace(/"/g, '\\"')}"
        end if
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
