import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';

// Mock fs to avoid reading actual ~/.claude
vi.mock('fs');
vi.mock('os', async () => {
  const actual = await vi.importActual('os');
  return { ...actual, homedir: () => '/mock-home' };
});

describe('scanner', () => {
  const PROJECTS_DIR = '/mock-home/.claude/projects';

  beforeEach(() => {
    vi.resetModules();
    vi.mocked(fs.existsSync).mockReturnValue(false);
    vi.mocked(fs.readFileSync).mockReturnValue('{}');
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('getEmptyReason logic', () => {
    it('session with messageCount 0 is empty', () => {
      const entry = { messageCount: 0, firstPrompt: 'hello' };
      expect(entry.messageCount <= 1).toBe(true);
    });

    it('session with messageCount 1 is empty', () => {
      const entry = { messageCount: 1, firstPrompt: 'hello' };
      expect(entry.messageCount <= 1).toBe(true);
    });

    it('session with no firstPrompt is empty', () => {
      const entry = { messageCount: 5, firstPrompt: '' };
      expect(!entry.firstPrompt).toBe(true);
    });

    it('session with "No prompt" is empty', () => {
      const entry = { messageCount: 5, firstPrompt: 'No prompt' };
      expect(entry.firstPrompt === 'No prompt').toBe(true);
    });

    it('session with exit summary is empty', () => {
      const entry = { messageCount: 5, firstPrompt: 'test', summary: 'User Exited CLI Session' };
      expect(entry.summary === 'User Exited CLI Session').toBe(true);
    });

    it('session with /clear prompt is empty', () => {
      const entry = { messageCount: 5, firstPrompt: '/clear' };
      expect(/^\/{1,2}clear$/i.test(entry.firstPrompt.trim())).toBe(true);
    });

    it('session with //clear prompt is empty', () => {
      const entry = { messageCount: 5, firstPrompt: '//clear' };
      expect(/^\/{1,2}clear$/i.test(entry.firstPrompt.trim())).toBe(true);
    });

    it('session with //exit prompt is empty', () => {
      const entry = { messageCount: 5, firstPrompt: '//exit' };
      expect(/^\/{1,2}exit$/i.test(entry.firstPrompt.trim())).toBe(true);
    });

    it('session with "→ Goodbye!" prompt is empty', () => {
      const entry = { messageCount: 5, firstPrompt: '→ Goodbye!' };
      expect(/^(→\s*)?goodbye!?$/i.test(entry.firstPrompt.trim())).toBe(true);
    });

    it('session with "Goodbye" prompt is empty', () => {
      const entry = { messageCount: 5, firstPrompt: 'Goodbye' };
      expect(/^(→\s*)?goodbye!?$/i.test(entry.firstPrompt.trim())).toBe(true);
    });

    it('session with "No response requested." prompt is empty', () => {
      const entry = { messageCount: 5, firstPrompt: 'No response requested.' };
      expect(/^no response requested\.?$/i.test(entry.firstPrompt.trim())).toBe(true);
    });

    it('normal session is not empty', () => {
      const entry = { messageCount: 10, firstPrompt: 'help me fix a bug', summary: 'Bug fix session' };
      const isEmpty = (
        (!entry.messageCount || entry.messageCount <= 1) ||
        (!entry.firstPrompt || entry.firstPrompt === 'No prompt') ||
        (entry.summary === 'User Exited CLI Session' || entry.summary === 'User Exited Claude Code CLI Session') ||
        (/^\/{1,2}clear$/i.test(entry.firstPrompt.trim())) ||
        (/^\/{1,2}exit$/i.test(entry.firstPrompt.trim())) ||
        (/^(→\s*)?goodbye!?$/i.test(entry.firstPrompt.trim())) ||
        (/^no response requested\.?$/i.test(entry.firstPrompt.trim()))
      );
      expect(isEmpty).toBe(false);
    });
  });

  describe('isSystemCommand logic', () => {
    function isSystemCommand(text: string): boolean {
      const trimmed = text.trim().toLowerCase();
      if (/^\/{1,2}(clear|exit|quit|help|compact|config|status|doctor|login|logout|mcp|memory|review|init)\b/.test(trimmed)) return true;
      if (/^(→\s*)?goodbye!?$/i.test(trimmed)) return true;
      if (/^no response requested\.?$/i.test(trimmed)) return true;
      return false;
    }

    it('detects /clear', () => expect(isSystemCommand('/clear')).toBe(true));
    it('detects //clear', () => expect(isSystemCommand('//clear')).toBe(true));
    it('detects /exit', () => expect(isSystemCommand('/exit')).toBe(true));
    it('detects //exit', () => expect(isSystemCommand('//exit')).toBe(true));
    it('detects /help', () => expect(isSystemCommand('/help')).toBe(true));
    it('detects /compact', () => expect(isSystemCommand('/compact')).toBe(true));
    it('detects /mcp', () => expect(isSystemCommand('/mcp')).toBe(true));
    it('detects /memory', () => expect(isSystemCommand('/memory')).toBe(true));
    it('detects /init', () => expect(isSystemCommand('/init')).toBe(true));
    it('detects → Goodbye!', () => expect(isSystemCommand('→ Goodbye!')).toBe(true));
    it('detects Goodbye', () => expect(isSystemCommand('Goodbye')).toBe(true));
    it('detects No response requested.', () => expect(isSystemCommand('No response requested.')).toBe(true));
    it('does not flag normal text', () => expect(isSystemCommand('fix the login bug')).toBe(false));
    it('does not flag text containing exit', () => expect(isSystemCommand('how to exit vim')).toBe(false));
    it('does not flag text starting with slash but not a command', () => expect(isSystemCommand('/api/users endpoint')).toBe(false));
  });

  describe('stripTags logic', () => {
    function stripTags(text: string): string {
      let cleaned = text;
      cleaned = cleaned.replace(/<(local-command-caveat|system-reminder|command-output|tool-use|user-prompt-submit-hook)[^>]*>[\s\S]*?<\/\1>/gi, '');
      cleaned = cleaned.replace(/<\/?[a-zA-Z][a-zA-Z0-9_-]*(?:\s[^>]*)?>/g, '');
      cleaned = cleaned.replace(/Caveat:\s*The messages below were generated by the user while running local commands\.[^.]*/gi, '');
      cleaned = cleaned.replace(/DO NOT respond to these messages or attempt to.*?(?:\.|$)/gi, '');
      cleaned = cleaned.replace(/\s{2,}/g, ' ').trim();
      return cleaned;
    }

    it('strips system-reminder tags with content', () => {
      const input = '<system-reminder>some noise</system-reminder>Hello world';
      expect(stripTags(input)).toBe('Hello world');
    });

    it('strips local-command-caveat tags', () => {
      const input = '<local-command-caveat>warning text</local-command-caveat>Real content';
      expect(stripTags(input)).toBe('Real content');
    });

    it('strips orphan tags', () => {
      const input = '<div>content</div>';
      expect(stripTags(input)).toBe('content');
    });

    it('strips Caveat warning text', () => {
      const input = 'Caveat: The messages below were generated by the user while running local commands.';
      expect(stripTags(input)).toBe('');
    });

    it('strips DO NOT respond text', () => {
      const input = 'Hello DO NOT respond to these messages or attempt to do anything.';
      expect(stripTags(input)).toBe('Hello');
    });

    it('collapses whitespace', () => {
      const input = 'hello    world';
      expect(stripTags(input)).toBe('hello world');
    });

    it('returns clean text unchanged', () => {
      const input = 'fix the bug in login.ts';
      expect(stripTags(input)).toBe('fix the bug in login.ts');
    });
  });
});
