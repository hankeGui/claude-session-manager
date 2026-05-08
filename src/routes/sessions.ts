import { Router, Request, Response } from 'express';
import { exec } from 'child_process';
import * as scanner from '../services/scanner';
import { readSessionMessages } from '../services/session-reader';
import { deleteSession, batchDelete } from '../services/session-cleaner';

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

router.post('/:sessionId/resume', (req: Request, res: Response) => {
  const { sessionId } = req.params;
  const found = scanner.getSessionById(sessionId);
  if (!found) {
    return res.status(404).json({ error: 'Session not found' });
  }

  const { project } = found;
  const { skipPermissions } = req.body || {};
  const cwd = project.projectPath || process.env.HOME;
  const flags = skipPermissions ? ' --dangerously-skip-permissions' : '';
  const cmd = `cd ${(cwd as string).replace(/"/g, '\\"')} && claude${flags} --resume ${sessionId}`;
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
    if (err) {
      return res.status(500).json({ error: 'Failed to open terminal', detail: err.message });
    }
    res.json({ success: true, terminal, cwd, sessionId });
  });
});

export default router;
