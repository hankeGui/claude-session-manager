const { Router } = require('express');
const { exec } = require('child_process');
const scanner = require('../services/scanner');
const { readSessionMessages } = require('../services/session-reader');
const { deleteSession, batchDelete } = require('../services/session-cleaner');

const router = Router();

// GET /api/sessions/:sessionId/messages
router.get('/:sessionId/messages', async (req, res) => {
  const { sessionId } = req.params;
  const limit = parseInt(req.query.limit) || 100;
  const offset = parseInt(req.query.offset) || 0;

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

// DELETE /api/sessions/:sessionId
router.delete('/:sessionId', async (req, res) => {
  const { sessionId } = req.params;
  const result = await deleteSession(sessionId);
  if (!result.success) {
    return res.status(404).json({ error: result.error });
  }
  res.json(result);
});

// POST /api/sessions/batch-delete
router.post('/batch-delete', async (req, res) => {
  const { sessionIds } = req.body;
  if (!Array.isArray(sessionIds) || sessionIds.length === 0) {
    return res.status(400).json({ error: 'sessionIds array required' });
  }
  const result = await batchDelete(sessionIds);
  res.json(result);
});

// POST /api/sessions/:sessionId/auto-rename
router.post('/:sessionId/auto-rename', (req, res) => {
  const { sessionId } = req.params;
  const found = scanner.getSessionById(sessionId);
  if (!found) {
    return res.status(404).json({ error: 'Session not found' });
  }

  const { project } = found;
  const cwd = project.projectPath || process.env.HOME;

  // Use claude -p with --resume to analyze the session and generate a title
  const prompt = 'Based on the conversation history in this session, generate a short descriptive title (under 50 characters, in the same language as the conversation). Output ONLY the title text, nothing else.';
  const cmd = `claude -p "${prompt.replace(/"/g, '\\"')}" --resume ${sessionId} --no-session-persistence --bare`;

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

// PUT /api/sessions/:sessionId/title
router.put('/:sessionId/title', (req, res) => {
  const { sessionId } = req.params;
  const { title } = req.body;

  const found = scanner.getSessionById(sessionId);
  if (!found) {
    return res.status(404).json({ error: 'Session not found' });
  }

  scanner.setTitle(sessionId, title || '');
  res.json({ success: true, sessionId, title: title || '' });
});

// POST /api/sessions/:sessionId/resume
router.post('/:sessionId/resume', (req, res) => {
  const { sessionId } = req.params;
  const found = scanner.getSessionById(sessionId);
  if (!found) {
    return res.status(404).json({ error: 'Session not found' });
  }

  const { project } = found;
  const { skipPermissions } = req.body || {};
  const cwd = project.projectPath || process.env.HOME;
  const flags = skipPermissions ? ' --dangerously-skip-permissions' : '';
  const cmd = `cd ${cwd.replace(/"/g, '\\"')} && claude${flags} --resume ${sessionId}`;
  const terminal = process.env.TERM_PROGRAM || 'Apple_Terminal';

  let script;
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
    // Default: macOS Terminal.app
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

module.exports = router;
