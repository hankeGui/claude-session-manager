import { describe, it, expect } from 'vitest';
import type { Session } from '../src/types';

// Extract pure functions from search.ts for isolated testing
// (these are module-private, so we replicate the logic here for unit tests)

function fuzzyMatch(query: string, target: string): number {
  const q = query.toLowerCase();
  const t = target.toLowerCase();
  let qi = 0;
  let score = 0;
  let lastIdx = -1;
  for (let ti = 0; ti < t.length && qi < q.length; ti++) {
    if (t[ti] === q[qi]) {
      score += (ti === lastIdx + 1) ? 2 : 1;
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
const FIELD_WEIGHTS: Record<string, number> = { title: 50, summary: 30, firstPrompt: 20, branch: 15, sessionId: 5 };

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

  if (/^\d+$/.test(q)) {
    if (tags.some(t => t === `PR#${q}`)) return { score: 200, matchedFields: ['tag'] };
  }
  if (tags.some(t => t.toLowerCase() === query)) return { score: 200, matchedFields: ['tag'] };

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

  // Fuzzy fallback with minimum threshold
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

function makeSession(overrides: Partial<Session> = {}): Session {
  return {
    sessionId: 'abc12345-1234-1234-1234-123456789012',
    customTitle: null,
    firstPrompt: 'help me fix a bug',
    summary: 'Bug fixing session',
    messageCount: 10,
    created: '2026-01-01T00:00:00Z',
    modified: '2026-01-02T00:00:00Z',
    gitBranch: 'feature/login',
    isEmpty: false,
    emptyReason: null,
    diskSize: 1024,
    dirName: 'project-dir',
    isFavorite: false,
    tags: [],
    ...overrides,
  };
}

describe('fuzzyMatch', () => {
  it('returns 0 when no match', () => {
    expect(fuzzyMatch('xyz', 'hello world')).toBe(0);
  });

  it('matches exact substring with consecutive bonus', () => {
    const score = fuzzyMatch('hello', 'hello world');
    expect(score).toBeGreaterThan(0);
  });

  it('matches scattered characters', () => {
    const score = fuzzyMatch('hlo', 'hello world');
    expect(score).toBeGreaterThan(0);
  });

  it('consecutive chars score higher than scattered', () => {
    const consecutive = fuzzyMatch('hel', 'hello');
    const scattered = fuzzyMatch('hlo', 'hello');
    expect(consecutive).toBeGreaterThan(scattered);
  });

  it('is case-insensitive', () => {
    expect(fuzzyMatch('HELLO', 'hello world')).toBeGreaterThan(0);
  });

  it('returns 0 when query is longer than target', () => {
    expect(fuzzyMatch('hello world foo', 'hello')).toBe(0);
  });

  it('returns 0 for empty query', () => {
    expect(fuzzyMatch('', 'hello')).toBe(0);
  });
});

describe('matchSession', () => {
  describe('weighted scoring', () => {
    it('title match scores 50', () => {
      const s = makeSession({ customTitle: 'Auth refactoring' });
      const result = matchSession(s, 'auth', 'default');
      expect(result.score).toBe(50);
      expect(result.matchedFields).toContain('title');
    });

    it('summary match scores 30', () => {
      const s = makeSession({ summary: 'Database migration fix' });
      const result = matchSession(s, 'migration', 'default');
      expect(result.score).toBe(30);
      expect(result.matchedFields).toContain('summary');
    });

    it('firstPrompt match scores 20', () => {
      const s = makeSession({ firstPrompt: 'fix the WebSocket connection' });
      const result = matchSession(s, 'websocket', 'default');
      expect(result.score).toBe(20);
      expect(result.matchedFields).toContain('firstPrompt');
    });

    it('branch match scores 15', () => {
      const s = makeSession({ gitBranch: 'feature/dark-mode' });
      const result = matchSession(s, 'dark-mode', 'default');
      expect(result.score).toBe(15);
      expect(result.matchedFields).toContain('branch');
    });

    it('sessionId match scores 5', () => {
      const s = makeSession({ sessionId: 'abc12345-dead-beef-1234-567890abcdef' });
      const result = matchSession(s, 'abc12345', 'default');
      expect(result.score).toBe(5);
      expect(result.matchedFields).toContain('sessionId');
    });

    it('tag partial match scores 20', () => {
      const s = makeSession({ tags: ['claude-session-manager'] });
      const result = matchSession(s, 'session-manager', 'default');
      expect(result.score).toBe(20);
      expect(result.matchedFields).toContain('tag');
    });

    it('multiple field matches accumulate scores', () => {
      const s = makeSession({ customTitle: 'Fix auth bug', summary: 'auth middleware refactor', firstPrompt: 'fix the auth issue' });
      const result = matchSession(s, 'auth', 'default');
      // title(50) + summary(30) + firstPrompt(20) = 100
      expect(result.score).toBe(100);
      expect(result.matchedFields).toContain('title');
      expect(result.matchedFields).toContain('summary');
      expect(result.matchedFields).toContain('firstPrompt');
    });

    it('title+tag match accumulates correctly', () => {
      const s = makeSession({ customTitle: 'Fix login flow', tags: ['login-page'], gitBranch: null });
      const result = matchSession(s, 'login', 'default');
      // title(50) + tag(20) = 70
      expect(result.score).toBe(70);
      expect(result.matchedFields).toEqual(expect.arrayContaining(['title', 'tag']));
    });
  });

  describe('exact tag match boost', () => {
    it('exact tag → score 200', () => {
      const s = makeSession({ tags: ['claude-session', 'PR#123'] });
      const result = matchSession(s, 'claude-session', 'default');
      expect(result.score).toBe(200);
      expect(result.matchedFields).toContain('tag');
    });

    it('exact Jira ticket match → score 200', () => {
      const s = makeSession({ tags: ['DC00-6266'] });
      expect(matchSession(s, 'DC00-6266', 'default').score).toBe(200);
    });

    it('case-insensitive exact tag match → score 200', () => {
      const s = makeSession({ tags: ['MyProject'] });
      expect(matchSession(s, 'myproject', 'default').score).toBe(200);
    });

    it('partial tag does NOT get 200 boost', () => {
      const s = makeSession({ tags: ['claude-session'] });
      const result = matchSession(s, 'claude', 'default');
      expect(result.score).not.toBe(200);
      expect(result.score).toBe(20); // tag partial match
    });
  });

  describe('PR number boost', () => {
    it('pure number matches PR#tag → score 200', () => {
      const s = makeSession({ tags: ['PR#17067'] });
      expect(matchSession(s, '17067', 'default').score).toBe(200);
    });

    it('pure number without matching PR tag → no boost', () => {
      const s = makeSession({ tags: ['PR#99999'] });
      expect(matchSession(s, '12345', 'default').score).not.toBe(200);
    });

    it('PR# prefix still works via exact tag match', () => {
      const s = makeSession({ tags: ['PR#17067'] });
      expect(matchSession(s, 'PR#17067', 'default').score).toBe(200);
    });
  });

  describe('fuzzy match with threshold', () => {
    it('rejects low-quality fuzzy matches (score < query.length * 2)', () => {
      const s = makeSession({ firstPrompt: 'Simple arithmetic query: 2+2 calculation' });
      const result = matchSession(s, 'pylon', 'default');
      expect(result.score).toBe(0);
      expect(result.matchedFields).toHaveLength(0);
    });

    it('rejects scattered character matches', () => {
      const s = makeSession({ summary: 'abcdefghijklmnop' });
      const result = matchSession(s, 'xyz', 'default');
      expect(result.score).toBe(0);
    });

    it('rejects near-miss fuzzy below threshold', () => {
      // 'authmod' (7 chars) → threshold 14, fuzzy score ~12 → rejected
      const s = makeSession({ firstPrompt: 'implement authentication module' });
      const result = matchSession(s, 'authmod', 'default');
      expect(result.score).toBe(0);
    });

    it('includes match still works (not fuzzy path)', () => {
      // 'auth' is a substring of 'authentication' → includes match
      const s = makeSession({ firstPrompt: 'authentication module' });
      const result = matchSession(s, 'auth', 'default');
      expect(result.score).toBe(20); // firstPrompt weight
      expect(result.matchedFields).toContain('firstPrompt');
    });
  });

  describe('regex mode', () => {
    it('matches regex pattern → score 1 with matched fields', () => {
      const s = makeSession({ firstPrompt: 'fix bug #123 in login' });
      const result = matchSession(s, 'bug\\s#\\d+', 'regex');
      expect(result.score).toBe(1);
      expect(result.matchedFields).toContain('firstPrompt');
    });

    it('returns 0 for no regex match', () => {
      const s = makeSession({ firstPrompt: 'hello world' });
      expect(matchSession(s, '^xyz$', 'regex').score).toBe(0);
    });

    it('returns 0 for invalid regex', () => {
      const s = makeSession({ firstPrompt: 'anything' });
      expect(matchSession(s, '[invalid', 'regex').score).toBe(0);
    });

    it('regex matches multiple fields', () => {
      const s = makeSession({ customTitle: 'WebSocket fix', firstPrompt: 'WebSocket handler broken' });
      const result = matchSession(s, 'websocket', 'regex');
      expect(result.score).toBe(1);
      expect(result.matchedFields).toContain('title');
      expect(result.matchedFields).toContain('firstPrompt');
    });
  });

  describe('edge cases', () => {
    it('handles session with all null/empty fields', () => {
      const s = makeSession({
        customTitle: null,
        summary: null,
        firstPrompt: null as any,
        gitBranch: null,
        tags: [],
      });
      expect(matchSession(s, 'anything', 'default').score).toBe(0);
    });

    it('returns 0 for no match', () => {
      const s = makeSession({ firstPrompt: 'fix a bug', summary: 'debugging' });
      expect(matchSession(s, 'zzzzzzz', 'default').score).toBe(0);
    });
  });
});
