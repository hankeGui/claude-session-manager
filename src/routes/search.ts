import { Router, Request, Response } from 'express';
import fs from 'fs';
import * as scanner from '../services/scanner';
import { askAi, getClient } from '../services/ai-client';
import * as aiScanner from '../services/ai-scanner';
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

interface MatchResult {
  score: number;
  matchedFields: string[];
}

const FIELD_NAMES = ['title', 'summary', 'firstPrompt', 'branch', 'sessionId'];

function matchSession(session: Session, q: string, mode: string): MatchResult {
  const tags = session.tags || [];
  const fieldValues = [
    session.customTitle || '',
    session.summary || '',
    session.firstPrompt || '',
    session.gitBranch || '',
    session.sessionId,
  ];

  if (mode === 'regex') {
    try {
      const re = new RegExp(q, 'i');
      const matched: string[] = [];
      fieldValues.forEach((f, i) => { if (re.test(f)) matched.push(FIELD_NAMES[i]); });
      tags.forEach(t => { if (re.test(t)) matched.push('tag'); });
      return { score: matched.length > 0 ? 1 : 0, matchedFields: matched };
    } catch {
      return { score: 0, matchedFields: [] };
    }
  }

  const query = q.toLowerCase();
  const matched: string[] = [];

  // Boost: if query looks like a number or ticket, check tags with PR# prefix
  if (/^\d+$/.test(q)) {
    if (tags.some(t => t === `PR#${q}`)) return { score: 200, matchedFields: ['tag'] };
  }
  // Boost: exact tag match (e.g. "DC00-6266")
  if (tags.some(t => t.toLowerCase() === query)) return { score: 200, matchedFields: ['tag'] };

  // Default: case-insensitive includes with weighted scoring
  const FIELD_WEIGHTS: Record<string, number> = { title: 50, summary: 30, firstPrompt: 20, branch: 15, sessionId: 5 };
  let totalScore = 0;

  fieldValues.forEach((f, i) => {
    if (f.toLowerCase().includes(query)) {
      matched.push(FIELD_NAMES[i]);
      totalScore += FIELD_WEIGHTS[FIELD_NAMES[i]] || 10;
    }
  });
  tags.forEach(t => {
    if (t.toLowerCase().includes(query)) {
      if (!matched.includes('tag')) matched.push('tag');
      totalScore += 20;
    }
  });

  if (matched.length > 0) return { score: totalScore, matchedFields: [...new Set(matched)] };

  // Fuzzy fallback — require minimum quality (score >= query.length * 2 means mostly consecutive)
  const minFuzzyScore = q.length * 2;
  let bestScore = 0;
  let bestField = '';
  fieldValues.forEach((f, i) => {
    const s = fuzzyMatch(q, f);
    if (s > bestScore) { bestScore = s; bestField = FIELD_NAMES[i]; }
  });
  if (bestScore < minFuzzyScore) return { score: 0, matchedFields: [] };
  return { score: bestScore, matchedFields: bestField ? [bestField] : [] };
}

router.get('/', (req: Request, res: Response) => {
  const { q, project, branch, empty, mode, favorite } = req.query as {
    q?: string; project?: string; branch?: string; empty?: string; mode?: string; favorite?: string;
  };
  const data = scanner.getData();
  const scored: { session: Session & { projectDisplayName: string; projectPath: string; _searchScore?: number; _matchedFields?: string[] }; score: number }[] = [];

  for (const p of data.projects) {
    if (project && p.dirName !== project) continue;

    for (const session of p.sessions) {
      if (branch && session.gitBranch !== branch) continue;
      if (empty === 'true' && !session.isEmpty) continue;
      if (empty === 'false' && session.isEmpty) continue;
      if (favorite === 'true' && !session.isFavorite) continue;

      if (q) {
        const { score, matchedFields } = matchSession(session, q, mode || 'default');
        if (score <= 0) continue;
        scored.push({
          session: { ...session, projectDisplayName: p.displayName, projectPath: p.projectPath, _searchScore: score, _matchedFields: matchedFields },
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

router.post('/deep', async (req: Request, res: Response) => {
  const { q } = req.body;
  if (!q) {
    return res.status(400).json({ error: 'Query required' });
  }

  if (!getClient()) {
    return res.status(400).json({ error: 'AI not configured', needsConfig: true });
  }

  const data = scanner.getData();

  const sessionSummaries: any[] = [];
  for (const p of data.projects) {
    for (const session of p.sessions) {
      // Use cached AI summary if available, otherwise read JSONL
      let snippet = '';
      const aiSummary = aiScanner.getSummary(session.sessionId);
      if (aiSummary) {
        snippet = aiSummary;
      } else {
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
      }

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

  try {
    const stdout = await askAi(prompt, { maxTokens: 2048 });

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

    // Auto-tag matched sessions with the search query
    for (const id of matchedIds) {
      scanner.addTags(id, [q], 'search');
    }

    res.json({ results, total: results.length, aiMatched: matchedIds.length });
  } catch (err: any) {
    res.status(500).json({ error: 'AI search failed', detail: err.message });
  }
});

export default router;
