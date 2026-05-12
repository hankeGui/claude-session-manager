import { Router, Request, Response } from 'express';
import { spawn } from 'child_process';
import fs from 'fs';
import * as scanner from '../services/scanner';
import { sessionJsonlPath } from '../utils/paths';
import type { Session } from '../types';

const router = Router();

// Fuzzy match: all query chars must appear in order in the target
function fuzzyMatch(query: string, target: string): number {
  const q = query.toLowerCase();
  const t = target.toLowerCase();
  let qi = 0;
  let score = 0;
  let lastIdx = -1;
  for (let ti = 0; ti < t.length && qi < q.length; ti++) {
    if (t[ti] === q[qi]) {
      score += (ti === lastIdx + 1) ? 2 : 1; // consecutive bonus
      lastIdx = ti;
      qi++;
    }
  }
  return qi === q.length ? score : 0;
}

function matchSession(session: Session, q: string, mode: string): number {
  const fields = [
    session.customTitle || '',
    session.summary || '',
    session.firstPrompt || '',
    session.gitBranch || '',
    session.sessionId,
  ];

  if (mode === 'regex') {
    try {
      const re = new RegExp(q, 'i');
      return fields.some(f => re.test(f)) ? 1 : 0;
    } catch {
      return 0; // invalid regex
    }
  }

  // Default: case-insensitive includes, fallback to fuzzy
  const query = q.toLowerCase();
  if (fields.some(f => f.toLowerCase().includes(query))) return 100;

  // Fuzzy fallback
  let bestScore = 0;
  for (const f of fields) {
    const s = fuzzyMatch(q, f);
    if (s > bestScore) bestScore = s;
  }
  return bestScore;
}

router.get('/', (req: Request, res: Response) => {
  const { q, project, branch, empty, mode, favorite } = req.query as {
    q?: string; project?: string; branch?: string; empty?: string; mode?: string; favorite?: string;
  };
  const data = scanner.getData();
  const scored: { session: Session & { projectDisplayName: string; projectPath: string }; score: number }[] = [];

  for (const p of data.projects) {
    if (project && p.dirName !== project) continue;

    for (const session of p.sessions) {
      if (branch && session.gitBranch !== branch) continue;
      if (empty === 'true' && !session.isEmpty) continue;
      if (empty === 'false' && session.isEmpty) continue;
      if (favorite === 'true' && !session.isFavorite) continue;

      if (q) {
        const score = matchSession(session, q, mode || 'default');
        if (score <= 0) continue;
        scored.push({
          session: { ...session, projectDisplayName: p.displayName, projectPath: p.projectPath },
          score,
        });
      } else {
        scored.push({
          session: { ...session, projectDisplayName: p.displayName, projectPath: p.projectPath },
          score: 0,
        });
      }
    }
  }

  // Sort: exact matches first (score 100), then by score desc, then by modified desc
  scored.sort((a, b) => {
    if (a.score !== b.score) return b.score - a.score;
    return (b.session.modified || '').localeCompare(a.session.modified || '');
  });

  const results = scored.map(s => s.session);
  res.json({ results, total: results.length });
});

router.post('/deep', (req: Request, res: Response) => {
  const { q } = req.body;
  if (!q) {
    return res.status(400).json({ error: 'Query required' });
  }

  const data = scanner.getData();

  const sessionSummaries: any[] = [];
  for (const p of data.projects) {
    for (const session of p.sessions) {
      let snippet = '';
      try {
        const filePath = sessionJsonlPath(session.dirName, session.sessionId);
        const content = fs.readFileSync(filePath, 'utf-8');
        const lines = content.split('\n');
        const userMsgs: string[] = [];
        for (const line of lines) {
          if (!line.includes('"type":"user"')) continue;
          try {
            const obj = JSON.parse(line);
            if (obj.type === 'user' && obj.message?.content) {
              const text = typeof obj.message.content === 'string'
                ? obj.message.content
                : obj.message.content.filter((b: any) => b.type === 'text').map((b: any) => b.text).join(' ');
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
  child.stdout.on('data', (chunk: Buffer) => { stdout += chunk; });
  child.stderr.on('data', (chunk: Buffer) => { stderr += chunk; });

  child.on('close', (code: number | null) => {
    if (code !== 0) {
      return res.status(500).json({ error: 'AI search failed', detail: stderr || `exit code ${code}` });
    }

    let matchedIds: string[] = [];
    try {
      const parsed = JSON.parse(stdout);
      if (Array.isArray(parsed)) {
        matchedIds = parsed;
      } else if (parsed.result) {
        matchedIds = JSON.parse(parsed.result);
      }
    } catch {
      const match = stdout.match(/\[[\s\S]*?\]/);
      if (match) {
        try { matchedIds = JSON.parse(match[0]); } catch {}
      }
    }

    const results: (Session & { projectDisplayName: string; projectPath: string })[] = [];
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

  child.on('error', (err: Error) => {
    res.status(500).json({ error: 'Failed to spawn claude', detail: err.message });
  });

  child.stdin.write(prompt);
  child.stdin.end();
});

export default router;
