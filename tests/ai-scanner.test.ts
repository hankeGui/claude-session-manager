import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs';
import os from 'os';

vi.mock('fs');
vi.mock('os', async () => {
  const actual = await vi.importActual('os');
  return { ...actual, homedir: () => '/mock-home' };
});

const mockGetData = vi.fn().mockReturnValue({
  projects: [{
    dirName: 'test-project',
    displayName: 'Test Project',
    projectPath: '/Users/test/project',
    sessions: [
      { sessionId: 'session-1', dirName: 'test-project', isEmpty: false, messageCount: 5, tags: [] },
      { sessionId: 'session-2', dirName: 'test-project', isEmpty: true, messageCount: 0, tags: [] },
      { sessionId: 'session-3', dirName: 'test-project', isEmpty: false, messageCount: 3, tags: [] },
    ],
  }],
});
const mockHasTagSource = vi.fn().mockReturnValue(false);
const mockAddTags = vi.fn();
const mockMarkTagSource = vi.fn();
const mockFlushTags = vi.fn();

vi.mock('../src/services/scanner', () => ({
  getData: () => mockGetData(),
  hasTagSource: (...args: any[]) => mockHasTagSource(...args),
  addTags: (...args: any[]) => mockAddTags(...args),
  markTagSource: (...args: any[]) => mockMarkTagSource(...args),
  flushTags: () => mockFlushTags(),
}));

vi.mock('../src/services/ai-client', () => ({
  getClient: vi.fn().mockReturnValue({ client: {}, model: 'test-model' }),
  askAi: vi.fn().mockResolvedValue('Test summary'),
}));

vi.mock('../src/services/session-reader', () => ({
  readSessionMessages: vi.fn().mockResolvedValue({
    messages: [
      { type: 'user', content: 'Fix the bug in https://github.wdf.sap.corp/orca/deepsea/pull/17067 related to https://jira.tools.sap/browse/DC00-6266' },
      { type: 'assistant', content: 'I will fix PR#17067' },
    ],
    total: 2,
  }),
}));

describe('ai-scanner', () => {
  let aiScanner: typeof import('../src/services/ai-scanner');

  beforeEach(async () => {
    vi.mocked(fs.readFileSync).mockReturnValue('{}');
    vi.mocked(fs.writeFileSync).mockImplementation(() => {});
    mockAddTags.mockClear();
    mockHasTagSource.mockReturnValue(false);
    mockMarkTagSource.mockClear();

    aiScanner = await import('../src/services/ai-scanner');
  });

  afterEach(() => {
    aiScanner.stop();
    vi.resetModules();
  });

  describe('extractRefTags (regex patterns)', () => {
    it('extracts PR numbers from GitHub URLs', async () => {
      await aiScanner.start();
      expect(mockAddTags).toHaveBeenCalledWith(
        'session-1',
        expect.arrayContaining(['PR#17067']),
        'refs',
      );
    });

    it('extracts Jira tickets from browse URLs', async () => {
      await aiScanner.start();
      expect(mockAddTags).toHaveBeenCalledWith(
        'session-1',
        expect.arrayContaining(['DC00-6266']),
        'refs',
      );
    });

    it('skips empty sessions', async () => {
      await aiScanner.start();
      const session2Calls = mockAddTags.mock.calls.filter((c: any) => c[0] === 'session-2');
      expect(session2Calls).toHaveLength(0);
    });

    it('skips sessions already ref-scanned', async () => {
      mockHasTagSource.mockReturnValue(true);
      await aiScanner.start();
      const refCalls = mockAddTags.mock.calls.filter((c: any) => c[2] === 'refs');
      expect(refCalls).toHaveLength(0);
    });
  });

  describe('summary management', () => {
    it('getSummary returns null for unknown session', () => {
      expect(aiScanner.getSummary('unknown')).toBeNull();
    });

    it('removeSummary handles missing session gracefully', () => {
      aiScanner.removeSummary('nonexistent');
      expect(aiScanner.getSummary('nonexistent')).toBeNull();
    });
  });

  describe('pause/resume', () => {
    it('getStatus reflects running state', () => {
      const status = aiScanner.getStatus();
      expect(status).toHaveProperty('running');
      expect(status).toHaveProperty('total');
      expect(status).toHaveProperty('done');
      expect(status).toHaveProperty('cached');
    });
  });

  describe('stop', () => {
    it('stops running scan', () => {
      aiScanner.stop();
      const status = aiScanner.getStatus();
      expect(status.running).toBe(false);
    });
  });
});

describe('extractRefTags patterns (unit)', () => {
  // Unit test the regex patterns directly
  const PR_RE = /\/pull\/(\d+)/g;
  const JIRA_RE = /\/browse\/([A-Z][A-Z0-9]+-\d+)/g;

  function extractRefTags(text: string): string[] {
    const found = new Set<string>();
    let m: RegExpExecArray | null;
    PR_RE.lastIndex = 0;
    JIRA_RE.lastIndex = 0;
    while ((m = PR_RE.exec(text)) !== null) found.add(`PR#${m[1]}`);
    while ((m = JIRA_RE.exec(text)) !== null) found.add(m[1]);
    return [...found];
  }

  it('extracts PR from standard GitHub URL', () => {
    expect(extractRefTags('https://github.com/org/repo/pull/123')).toEqual(['PR#123']);
  });

  it('extracts PR from enterprise GitHub URL', () => {
    expect(extractRefTags('https://github.wdf.sap.corp/orca/deepsea/pull/17067')).toEqual(['PR#17067']);
  });

  it('extracts Jira ticket from browse URL', () => {
    expect(extractRefTags('https://jira.tools.sap/browse/DC00-6266')).toEqual(['DC00-6266']);
  });

  it('extracts multiple PRs from one text', () => {
    const text = 'See /pull/100 and /pull/200 for context';
    const tags = extractRefTags(text);
    expect(tags).toContain('PR#100');
    expect(tags).toContain('PR#200');
  });

  it('extracts mixed PR and Jira', () => {
    const text = '/pull/555 and /browse/PROJ-42';
    const tags = extractRefTags(text);
    expect(tags).toContain('PR#555');
    expect(tags).toContain('PROJ-42');
  });

  it('deduplicates same PR number', () => {
    const text = '/pull/100 and again /pull/100';
    expect(extractRefTags(text)).toEqual(['PR#100']);
  });

  it('returns empty for text without refs', () => {
    expect(extractRefTags('just some random text')).toEqual([]);
  });

  it('handles various Jira ticket formats', () => {
    expect(extractRefTags('/browse/ABC-1')).toEqual(['ABC-1']);
    expect(extractRefTags('/browse/BDCDPISUPPORT-247')).toEqual(['BDCDPISUPPORT-247']);
    expect(extractRefTags('/browse/X2Y-99')).toEqual(['X2Y-99']);
  });

  it('does not match lowercase jira tickets', () => {
    expect(extractRefTags('/browse/abc-123')).toEqual([]);
  });

  it('does not match PR without number', () => {
    expect(extractRefTags('/pull/')).toEqual([]);
    expect(extractRefTags('/pull/abc')).toEqual([]);
  });
});
