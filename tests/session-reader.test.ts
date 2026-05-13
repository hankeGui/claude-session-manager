import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';

const TMP_DIR = path.join(os.tmpdir(), 'csm-test-reader-' + Date.now());

// Mock the paths module so readSessionMessages uses our temp directory
vi.mock('../src/utils/paths', () => ({
  sessionJsonlPath: (dirName: string, sessionId: string) =>
    path.join(TMP_DIR, dirName, `${sessionId}.jsonl`),
}));

import { readSessionMessages } from '../src/services/session-reader';

const FAKE_PROJECT = 'test-project';
const FAKE_SESSION = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';

function writeJsonl(sessionId: string, entries: any[]) {
  const dir = path.join(TMP_DIR, FAKE_PROJECT);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, `${sessionId}.jsonl`), entries.map(e => JSON.stringify(e)).join('\n'));
}

describe('session-reader', () => {
  beforeAll(() => {
    fs.mkdirSync(path.join(TMP_DIR, FAKE_PROJECT), { recursive: true });
  });

  afterAll(() => {
    fs.rmSync(TMP_DIR, { recursive: true, force: true });
  });

  it('reads basic user/assistant conversation', async () => {
    writeJsonl(FAKE_SESSION, [
      { type: 'user', message: { content: 'Hello' }, timestamp: '2026-01-01T00:00:00Z' },
      { type: 'assistant', message: { content: 'Hi there!' }, timestamp: '2026-01-01T00:00:01Z' },
    ]);
    const result = await readSessionMessages(FAKE_PROJECT, FAKE_SESSION);
    expect(result.messages).toHaveLength(2);
    expect(result.messages[0]).toEqual({ type: 'user', content: 'Hello', timestamp: '2026-01-01T00:00:00Z' });
    expect(result.messages[1]).toEqual({ type: 'assistant', content: 'Hi there!', timestamp: '2026-01-01T00:00:01Z' });
  });

  it('merges consecutive assistant messages into one turn', async () => {
    const sid = 'merge-test-1';
    writeJsonl(sid, [
      { type: 'user', message: { content: 'Do something' }, timestamp: 't0' },
      { type: 'assistant', message: { content: [{ type: 'text', text: 'Let me help.' }] }, timestamp: 't1' },
      { type: 'assistant', message: { content: [{ type: 'tool_use', name: 'Read' }] }, timestamp: 't2' },
      { type: 'assistant', message: { content: [{ type: 'tool_use', name: 'Edit' }] }, timestamp: 't3' },
      { type: 'assistant', message: { content: [{ type: 'text', text: 'Done!' }] }, timestamp: 't4' },
    ]);
    const result = await readSessionMessages(FAKE_PROJECT, sid);
    expect(result.messages).toHaveLength(2); // 1 user + 1 merged assistant
    expect(result.messages[1].type).toBe('assistant');
    expect(result.messages[1].content).toBe('Let me help.\nDone!');
    expect(result.messages[1].toolCalls!.map(t => t.name)).toEqual(['Read', 'Edit']);
  });

  it('shows tool-only assistant turns with tool names', async () => {
    const sid = 'tool-only-1';
    writeJsonl(sid, [
      { type: 'user', message: { content: 'Fix it' }, timestamp: 't0' },
      { type: 'assistant', message: { content: [{ type: 'tool_use', name: 'Read' }] }, timestamp: 't1' },
      { type: 'assistant', message: { content: [{ type: 'tool_use', name: 'Edit' }] }, timestamp: 't2' },
      { type: 'assistant', message: { content: [{ type: 'tool_use', name: 'Bash' }] }, timestamp: 't3' },
    ]);
    const result = await readSessionMessages(FAKE_PROJECT, sid);
    expect(result.messages).toHaveLength(2); // user + assistant turn
    const assistant = result.messages[1];
    expect(assistant.content).toBe('');
    expect(assistant.toolCalls!.map(t => t.name)).toEqual(['Read', 'Edit', 'Bash']);
  });

  it('skips non-user/assistant types', async () => {
    const sid = 'skip-types-1';
    writeJsonl(sid, [
      { type: 'file-history-snapshot', data: {} },
      { type: 'user', message: { content: 'Hi' }, timestamp: 't0' },
      { type: 'system', message: { content: 'system msg' } },
      { type: 'attachment', data: {} },
      { type: 'assistant', message: { content: 'Hello' }, timestamp: 't1' },
      { type: 'permission-mode', data: {} },
    ]);
    const result = await readSessionMessages(FAKE_PROJECT, sid);
    expect(result.messages).toHaveLength(2);
  });

  it('handles array content in user messages', async () => {
    const sid = 'user-array-1';
    writeJsonl(sid, [
      { type: 'user', message: { content: [{ type: 'text', text: 'Hello from array' }] }, timestamp: 't0' },
      { type: 'assistant', message: { content: 'Response' }, timestamp: 't1' },
    ]);
    const result = await readSessionMessages(FAKE_PROJECT, sid);
    expect(result.messages[0].content).toBe('Hello from array');
  });

  it('truncates long assistant content', async () => {
    const sid = 'truncate-1';
    const longText = 'x'.repeat(5000);
    writeJsonl(sid, [
      { type: 'user', message: { content: 'Hi' }, timestamp: 't0' },
      { type: 'assistant', message: { content: longText }, timestamp: 't1' },
    ]);
    const result = await readSessionMessages(FAKE_PROJECT, sid);
    expect(result.messages[1].content.length).toBeLessThan(5000);
    expect(result.messages[1].content).toContain('(truncated)');
  });

  it('handles empty file gracefully', async () => {
    const sid = 'empty-file-1';
    writeJsonl(sid, []);
    const result = await readSessionMessages(FAKE_PROJECT, sid);
    expect(result.messages).toHaveLength(0);
    expect(result.total).toBe(0);
  });

  it('skips invalid JSON lines', async () => {
    const sid = 'invalid-json-1';
    const dir = path.join(TMP_DIR, FAKE_PROJECT);
    fs.writeFileSync(path.join(dir, `${sid}.jsonl`), [
      'invalid json',
      JSON.stringify({ type: 'user', message: { content: 'valid' }, timestamp: 't0' }),
      'also invalid',
      JSON.stringify({ type: 'assistant', message: { content: 'reply' }, timestamp: 't1' }),
    ].join('\n'));
    const result = await readSessionMessages(FAKE_PROJECT, sid);
    expect(result.messages).toHaveLength(2);
  });

  it('respects offset and limit', async () => {
    const sid = 'pagination-1';
    const entries = [];
    for (let i = 0; i < 10; i++) {
      entries.push({ type: 'user', message: { content: `msg ${i}` }, timestamp: `t${i * 2}` });
      entries.push({ type: 'assistant', message: { content: `reply ${i}` }, timestamp: `t${i * 2 + 1}` });
    }
    writeJsonl(sid, entries);
    // 20 turns total (user/assistant alternate, no consecutive assistant merging)
    // offset=2 skips first 2 (msg 0, reply 0), limit=3 returns next 3
    const result = await readSessionMessages(FAKE_PROJECT, sid, { limit: 3, offset: 2 });
    expect(result.messages).toHaveLength(3);
    expect(result.messages[0].content).toBe('msg 1');
    expect(result.messages[1].content).toBe('reply 1');
    expect(result.messages[2].content).toBe('msg 2');
    expect(result.total).toBe(20);
  });

  it('returns file not found as empty', async () => {
    const result = await readSessionMessages(FAKE_PROJECT, 'nonexistent-id');
    expect(result.messages).toHaveLength(0);
    expect(result.total).toBe(0);
  });

  it('skips tool_result user messages without breaking assistant merge', async () => {
    const sid = 'tool-result-1';
    writeJsonl(sid, [
      { type: 'user', message: { content: 'Do it' }, timestamp: 't0' },
      { type: 'assistant', message: { content: [{ type: 'tool_use', name: 'Read' }] }, timestamp: 't1' },
      // tool_result from system (appears as user type in JSONL)
      { type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 'x', content: 'file contents...' }] }, timestamp: 't2' },
      { type: 'assistant', message: { content: [{ type: 'tool_use', name: 'Edit' }] }, timestamp: 't3' },
      { type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 'y', content: 'ok' }] }, timestamp: 't4' },
      { type: 'assistant', message: { content: [{ type: 'text', text: 'All done!' }] }, timestamp: 't5' },
    ]);
    const result = await readSessionMessages(FAKE_PROJECT, sid);
    // Should be: 1 user + 1 merged assistant (tool_results don't split the turn)
    expect(result.messages).toHaveLength(2);
    expect(result.messages[1].content).toBe('All done!');
    expect(result.messages[1].toolCalls!.map(t => t.name)).toEqual(['Read', 'Edit']);
  });

  it('ignores thinking blocks in assistant messages', async () => {
    const sid = 'thinking-1';
    writeJsonl(sid, [
      { type: 'user', message: { content: 'Think about it' }, timestamp: 't0' },
      { type: 'assistant', message: { content: [{ type: 'thinking', thinking: 'hmm...' }] }, timestamp: 't1' },
      { type: 'assistant', message: { content: [{ type: 'text', text: 'Here is my answer' }] }, timestamp: 't2' },
    ]);
    const result = await readSessionMessages(FAKE_PROJECT, sid);
    expect(result.messages).toHaveLength(2);
    expect(result.messages[1].content).toBe('Here is my answer');
    expect(result.messages[1].toolCalls).toBeUndefined();
  });

  it('splits turns on user message boundaries', async () => {
    const sid = 'turn-split-1';
    writeJsonl(sid, [
      { type: 'user', message: { content: 'Q1' }, timestamp: 't0' },
      { type: 'assistant', message: { content: [{ type: 'tool_use', name: 'Read' }] }, timestamp: 't1' },
      { type: 'assistant', message: { content: [{ type: 'text', text: 'Answer 1' }] }, timestamp: 't2' },
      { type: 'user', message: { content: 'Q2' }, timestamp: 't3' },
      { type: 'assistant', message: { content: [{ type: 'text', text: 'Answer 2' }] }, timestamp: 't4' },
    ]);
    const result = await readSessionMessages(FAKE_PROJECT, sid);
    expect(result.messages).toHaveLength(4); // user, assistant(merged), user, assistant
    expect(result.messages[1].content).toBe('Answer 1');
    expect(result.messages[1].toolCalls!.map(t => t.name)).toEqual(['Read']);
    expect(result.messages[3].content).toBe('Answer 2');
  });

  describe('noise message filtering', () => {
    it('filters slash commands by default (includeNoise=false)', async () => {
      const sid = 'noise-slash-1';
      writeJsonl(sid, [
        { type: 'user', message: { content: 'Hello' }, timestamp: 't0' },
        { type: 'assistant', message: { content: 'Hi!' }, timestamp: 't1' },
        { type: 'user', message: { content: '/exit' }, timestamp: 't2' },
        { type: 'assistant', message: { content: 'Goodbye!' }, timestamp: 't3' },
        { type: 'user', message: { content: '//clear' }, timestamp: 't4' },
      ]);
      const result = await readSessionMessages(FAKE_PROJECT, sid, { includeNoise: false });
      expect(result.messages).toHaveLength(2); // only Hello + Hi!
      expect(result.messages[0].content).toBe('Hello');
      expect(result.totalUnfiltered).toBe(5);
    });

    it('includes noise when includeNoise=true', async () => {
      const sid = 'noise-include-1';
      writeJsonl(sid, [
        { type: 'user', message: { content: 'Hello' }, timestamp: 't0' },
        { type: 'assistant', message: { content: 'Hi!' }, timestamp: 't1' },
        { type: 'user', message: { content: '/exit' }, timestamp: 't2' },
      ]);
      const result = await readSessionMessages(FAKE_PROJECT, sid, { includeNoise: true });
      expect(result.messages).toHaveLength(3);
    });

    it('filters "Bye!" and "No response requested." messages', async () => {
      const sid = 'noise-bye-1';
      writeJsonl(sid, [
        { type: 'user', message: { content: 'Do something' }, timestamp: 't0' },
        { type: 'assistant', message: { content: 'Done!' }, timestamp: 't1' },
        { type: 'user', message: { content: 'Bye!' }, timestamp: 't2' },
        { type: 'assistant', message: { content: 'No response requested.' }, timestamp: 't3' },
      ]);
      const result = await readSessionMessages(FAKE_PROJECT, sid, { includeNoise: false });
      expect(result.messages).toHaveLength(2);
      expect(result.messages[0].content).toBe('Do something');
      expect(result.messages[1].content).toBe('Done!');
    });

    it('filters //exit and /quit variants', async () => {
      const sid = 'noise-variants-1';
      writeJsonl(sid, [
        { type: 'user', message: { content: 'Hi' }, timestamp: 't0' },
        { type: 'assistant', message: { content: 'Hello' }, timestamp: 't1' },
        { type: 'user', message: { content: '//exit' }, timestamp: 't2' },
        { type: 'user', message: { content: '/quit' }, timestamp: 't3' },
        { type: 'user', message: { content: '/compact' }, timestamp: 't4' },
      ]);
      const result = await readSessionMessages(FAKE_PROJECT, sid, { includeNoise: false });
      expect(result.messages).toHaveLength(2);
    });

    it('does not filter normal messages that happen to contain slash', async () => {
      const sid = 'noise-normal-1';
      writeJsonl(sid, [
        { type: 'user', message: { content: 'check the /etc/hosts file' }, timestamp: 't0' },
        { type: 'assistant', message: { content: 'Here it is' }, timestamp: 't1' },
      ]);
      const result = await readSessionMessages(FAKE_PROJECT, sid, { includeNoise: false });
      expect(result.messages).toHaveLength(2);
    });

    it('totalUnfiltered reflects pre-filter count', async () => {
      const sid = 'noise-count-1';
      writeJsonl(sid, [
        { type: 'user', message: { content: 'Hello' }, timestamp: 't0' },
        { type: 'assistant', message: { content: 'Hi' }, timestamp: 't1' },
        { type: 'user', message: { content: '/exit' }, timestamp: 't2' },
        { type: 'assistant', message: { content: 'No response requested.' }, timestamp: 't3' },
        { type: 'user', message: { content: 'Goodbye!' }, timestamp: 't4' },
      ]);
      const result = await readSessionMessages(FAKE_PROJECT, sid, { includeNoise: false });
      expect(result.totalUnfiltered).toBe(5);
      expect(result.total).toBeLessThan(5);
    });
  });
});
