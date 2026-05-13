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

function matchSession(session: Session, q: string, mode: string): number {
  const tags = session.tags || [];
  const fields = [
    session.customTitle || '',
    session.summary || '',
    session.firstPrompt || '',
    session.gitBranch || '',
    session.sessionId,
    ...tags,
  ];

  if (mode === 'regex') {
    try {
      const re = new RegExp(q, 'i');
      return fields.some(f => re.test(f)) ? 1 : 0;
    } catch {
      return 0;
    }
  }

  const query = q.toLowerCase();

  if (/^\d+$/.test(q)) {
    if (tags.some(t => t === `PR#${q}`)) return 200;
  }
  if (tags.some(t => t.toLowerCase() === query)) return 200;

  if (fields.some(f => f.toLowerCase().includes(query))) return 100;

  let bestScore = 0;
  for (const f of fields) {
    const s = fuzzyMatch(q, f);
    if (s > bestScore) bestScore = s;
  }
  return bestScore;
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
  describe('default mode (includes + fuzzy)', () => {
    it('matches firstPrompt (includes) → score 100', () => {
      const s = makeSession({ firstPrompt: 'fix the WebSocket connection' });
      expect(matchSession(s, 'websocket', 'default')).toBe(100);
    });

    it('matches customTitle (includes) → score 100', () => {
      const s = makeSession({ customTitle: 'Auth refactoring' });
      expect(matchSession(s, 'auth', 'default')).toBe(100);
    });

    it('matches summary (includes) → score 100', () => {
      const s = makeSession({ summary: 'Database migration fix' });
      expect(matchSession(s, 'migration', 'default')).toBe(100);
    });

    it('matches gitBranch (includes) → score 100', () => {
      const s = makeSession({ gitBranch: 'feature/dark-mode' });
      expect(matchSession(s, 'dark-mode', 'default')).toBe(100);
    });

    it('matches sessionId (includes) → score 100', () => {
      const s = makeSession({ sessionId: 'abc12345-dead-beef-1234-567890abcdef' });
      expect(matchSession(s, 'abc12345', 'default')).toBe(100);
    });

    it('matches tag exactly → score 200', () => {
      const s = makeSession({ tags: ['claude-session', 'PR#123'] });
      expect(matchSession(s, 'claude-session', 'default')).toBe(200);
    });

    it('matches tag partially (includes) → score 100', () => {
      const s = makeSession({ tags: ['claude-session-manager'] });
      expect(matchSession(s, 'session-manager', 'default')).toBe(100);
    });

    it('falls back to fuzzy match with lower score', () => {
      const s = makeSession({ firstPrompt: 'implement authentication module' });
      const score = matchSession(s, 'authmod', 'default');
      expect(score).toBeGreaterThan(0);
      expect(score).toBeLessThan(100);
    });

    it('returns 0 for no match', () => {
      const s = makeSession({ firstPrompt: 'fix a bug', summary: 'debugging' });
      expect(matchSession(s, 'zzzzzzz', 'default')).toBe(0);
    });
  });

  describe('PR number boost', () => {
    it('pure number matches PR#tag → score 200', () => {
      const s = makeSession({ tags: ['PR#17067'] });
      expect(matchSession(s, '17067', 'default')).toBe(200);
    });

    it('pure number without matching PR tag → no boost', () => {
      const s = makeSession({ tags: ['PR#99999'] });
      // 12345 is not in tags as PR#12345, but might be in other fields
      expect(matchSession(s, '12345', 'default')).not.toBe(200);
    });

    it('PR# prefix still works via includes', () => {
      const s = makeSession({ tags: ['PR#17067'] });
      expect(matchSession(s, 'PR#17067', 'default')).toBe(200); // exact tag match
    });
  });

  describe('exact tag match boost', () => {
    it('exact Jira ticket match → score 200', () => {
      const s = makeSession({ tags: ['DC00-6266'] });
      expect(matchSession(s, 'DC00-6266', 'default')).toBe(200);
    });

    it('case-insensitive exact tag match → score 200', () => {
      const s = makeSession({ tags: ['MyProject'] });
      expect(matchSession(s, 'myproject', 'default')).toBe(200);
    });

    it('partial tag does NOT get 200 boost', () => {
      const s = makeSession({ tags: ['claude-session'] });
      // "claude" is a partial match, should be includes (100), not exact tag (200)
      expect(matchSession(s, 'claude', 'default')).toBe(100);
    });
  });

  describe('regex mode', () => {
    it('matches regex pattern → score 1', () => {
      const s = makeSession({ firstPrompt: 'fix bug #123 in login' });
      expect(matchSession(s, 'bug\\s#\\d+', 'regex')).toBe(1);
    });

    it('returns 0 for no regex match', () => {
      const s = makeSession({ firstPrompt: 'hello world' });
      expect(matchSession(s, '^xyz$', 'regex')).toBe(0);
    });

    it('returns 0 for invalid regex', () => {
      const s = makeSession({ firstPrompt: 'anything' });
      expect(matchSession(s, '[invalid', 'regex')).toBe(0);
    });

    it('regex is case-insensitive', () => {
      const s = makeSession({ firstPrompt: 'WebSocket handler' });
      expect(matchSession(s, 'websocket', 'regex')).toBe(1);
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
      expect(matchSession(s, 'anything', 'default')).toBe(0);
    });

    it('handles empty query', () => {
      const s = makeSession({ firstPrompt: 'hello' });
      // Empty string: includes returns true for everything
      expect(matchSession(s, '', 'default')).toBe(100);
    });
  });
});
