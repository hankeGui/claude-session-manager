const { Router } = require('express');
const { spawn } = require('child_process');
const fs = require('fs');
const scanner = require('../services/scanner');
const { sessionJsonlPath } = require('../utils/paths');

const router = Router();

// GET /api/search?q=text&project=dirName&branch=name&empty=true
router.get('/', (req, res) => {
  const { q, project, branch, empty } = req.query;
  const data = scanner.getData();
  let results = [];

  for (const p of data.projects) {
    if (project && p.dirName !== project) continue;

    for (const session of p.sessions) {
      if (branch && session.gitBranch !== branch) continue;
      if (empty === 'true' && !session.isEmpty) continue;
      if (empty === 'false' && session.isEmpty) continue;

      if (q) {
        const query = q.toLowerCase();
        const matchInTitle = (session.customTitle || '').toLowerCase().includes(query);
        const matchInSummary = (session.summary || '').toLowerCase().includes(query);
        const matchInPrompt = (session.firstPrompt || '').toLowerCase().includes(query);
        const matchInBranch = (session.gitBranch || '').toLowerCase().includes(query);

        if (!matchInTitle && !matchInSummary && !matchInPrompt && !matchInBranch) continue;
      }

      results.push({
        ...session,
        projectDisplayName: p.displayName,
        projectPath: p.projectPath,
      });
    }
  }

  // Sort by modified desc
  results.sort((a, b) => (b.modified || '').localeCompare(a.modified || ''));

  res.json({ results, total: results.length });
});

// POST /api/search/deep - AI-powered deep search through session content
router.post('/deep', (req, res) => {
  const { q } = req.body;
  if (!q) {
    return res.status(400).json({ error: 'Query required' });
  }

  const data = scanner.getData();

  // Build a summary of all sessions for Claude to analyze
  const sessionSummaries = [];
  for (const p of data.projects) {
    for (const session of p.sessions) {
      // Read first few lines of each session to get context
      let snippet = '';
      try {
        const filePath = sessionJsonlPath(session.dirName, session.sessionId);
        const content = fs.readFileSync(filePath, 'utf-8');
        const lines = content.split('\n');
        const userMsgs = [];
        for (const line of lines) {
          if (!line.includes('"type":"user"')) continue;
          try {
            const obj = JSON.parse(line);
            if (obj.type === 'user' && obj.message && obj.message.content) {
              const text = typeof obj.message.content === 'string'
                ? obj.message.content
                : obj.message.content.filter(b => b.type === 'text').map(b => b.text).join(' ');
              if (text.trim()) userMsgs.push(text.slice(0, 200));
            }
          } catch {}
          if (userMsgs.length >= 5) break;
        }
        snippet = userMsgs.join(' | ');
      } catch {}

      sessionSummaries.push({
        id: session.sessionId,
        project: p.displayName,
        title: session.customTitle || session.summary || '',
        firstPrompt: (session.firstPrompt || '').slice(0, 150),
        branch: session.gitBranch || '',
        msgs: session.messageCount,
        snippet: snippet.slice(0, 400),
      });
    }
  }

  const prompt = `I have ${sessionSummaries.length} Claude Code sessions. The user is searching for: "${q}"

Here are all sessions with their metadata and user message snippets:
${JSON.stringify(sessionSummaries, null, 0)}

Return ONLY a JSON array of session IDs that likely match the user's search query. Consider semantic meaning, not just keyword matching. If nothing matches, return an empty array [].
Output format: ["id1", "id2", ...]`;

  const child = spawn('claude', ['-p', '--no-session-persistence', '--bare'], {
    timeout: 60000,
    stdio: ['pipe', 'pipe', 'pipe'],
  });

  let stdout = '';
  let stderr = '';
  child.stdout.on('data', (chunk) => { stdout += chunk; });
  child.stderr.on('data', (chunk) => { stderr += chunk; });

  child.on('close', (code) => {
    if (code !== 0) {
      return res.status(500).json({ error: 'AI search failed', detail: stderr || `exit code ${code}` });
    }

    let matchedIds = [];
    try {
      const parsed = JSON.parse(stdout);
      if (Array.isArray(parsed)) {
        matchedIds = parsed;
      } else if (parsed.result) {
        matchedIds = JSON.parse(parsed.result);
      }
    } catch {
      // Try to extract array from raw text
      const match = stdout.match(/\[[\s\S]*?\]/);
      if (match) {
        try { matchedIds = JSON.parse(match[0]); } catch {}
      }
    }

    // Look up full session data for matched IDs
    const results = [];
    const idSet = new Set(matchedIds);
    for (const p of data.projects) {
      for (const session of p.sessions) {
        if (idSet.has(session.sessionId)) {
          results.push({
            ...session,
            projectDisplayName: p.displayName,
            projectPath: p.projectPath,
          });
        }
      }
    }

    res.json({ results, total: results.length, aiMatched: matchedIds.length });
  });

  child.on('error', (err) => {
    res.status(500).json({ error: 'Failed to spawn claude', detail: err.message });
  });

  child.stdin.write(prompt);
  child.stdin.end();
});

module.exports = router;
