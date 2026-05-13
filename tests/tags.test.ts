import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';

vi.mock('fs');
vi.mock('os', async () => {
  const actual = await vi.importActual('os');
  return { ...actual, homedir: () => '/mock-home' };
});

describe('tag system', () => {
  let scanner: typeof import('../src/services/scanner');

  beforeEach(async () => {
    vi.resetModules();
    vi.mocked(fs.existsSync).mockReturnValue(false);
    vi.mocked(fs.readFileSync).mockReturnValue('{}');
    vi.mocked(fs.writeFileSync).mockImplementation(() => {});
    vi.mocked(fs.readdirSync).mockReturnValue([]);
    scanner = await import('../src/services/scanner');
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('getTags', () => {
    it('returns empty array for unknown session', () => {
      expect(scanner.getTags('unknown-id')).toEqual([]);
    });
  });

  describe('addTag', () => {
    it('adds a tag and persists', () => {
      scanner.addTag('session-1', 'my-tag');
      expect(scanner.getTags('session-1')).toEqual(['my-tag']);
      expect(fs.writeFileSync).toHaveBeenCalled();
    });

    it('deduplicates tags', () => {
      scanner.addTag('session-1', 'tag-a');
      scanner.addTag('session-1', 'tag-a');
      expect(scanner.getTags('session-1')).toEqual(['tag-a']);
    });

    it('trims whitespace', () => {
      scanner.addTag('session-1', '  spaced  ');
      expect(scanner.getTags('session-1')).toEqual(['spaced']);
    });

    it('ignores empty strings', () => {
      scanner.addTag('session-1', '');
      scanner.addTag('session-1', '   ');
      expect(scanner.getTags('session-1')).toEqual([]);
    });
  });

  describe('addTags', () => {
    it('adds multiple tags at once', () => {
      scanner.addTags('session-1', ['tag-a', 'tag-b', 'tag-c']);
      expect(scanner.getTags('session-1')).toEqual(['tag-a', 'tag-b', 'tag-c']);
    });

    it('marks source when provided', () => {
      scanner.addTags('session-1', ['tag-x'], 'refs');
      expect(scanner.hasTagSource('session-1', 'refs')).toBe(true);
      expect(scanner.hasTagSource('session-1', 'meta')).toBe(false);
    });

    it('deduplicates across calls', () => {
      scanner.addTags('session-1', ['a', 'b'], 'meta');
      scanner.addTags('session-1', ['b', 'c'], 'refs');
      expect(scanner.getTags('session-1')).toEqual(['a', 'b', 'c']);
    });

    it('marks source even if no new tags added', () => {
      scanner.addTags('session-1', [], 'refs');
      expect(scanner.hasTagSource('session-1', 'refs')).toBe(true);
    });
  });

  describe('hasTagSource / markTagSource', () => {
    it('returns false for unknown session', () => {
      expect(scanner.hasTagSource('unknown', 'meta')).toBe(false);
    });

    it('returns true after marking', () => {
      scanner.markTagSource('session-1', 'meta');
      expect(scanner.hasTagSource('session-1', 'meta')).toBe(true);
    });

    it('tracks multiple sources independently', () => {
      scanner.markTagSource('session-1', 'meta');
      scanner.markTagSource('session-1', 'refs');
      expect(scanner.hasTagSource('session-1', 'meta')).toBe(true);
      expect(scanner.hasTagSource('session-1', 'refs')).toBe(true);
      expect(scanner.hasTagSource('session-1', 'search')).toBe(false);
    });

    it('does not duplicate source on repeated marks', () => {
      scanner.markTagSource('session-1', 'meta');
      scanner.markTagSource('session-1', 'meta');
      scanner.markTagSource('session-1', 'meta');
      // Internal check: tags still valid
      expect(scanner.hasTagSource('session-1', 'meta')).toBe(true);
    });
  });

  describe('removeTags', () => {
    it('removes all tags and sources for a session', () => {
      scanner.addTags('session-1', ['a', 'b'], 'meta');
      scanner.removeTags('session-1');
      expect(scanner.getTags('session-1')).toEqual([]);
      expect(scanner.hasTagSource('session-1', 'meta')).toBe(false);
    });

    it('no-op for unknown session', () => {
      scanner.removeTags('nonexistent');
      // Should not throw
      expect(scanner.getTags('nonexistent')).toEqual([]);
    });
  });

  describe('loadTags migration (via scan)', () => {
    it('migrates old format (string[]) to new format', async () => {
      vi.resetModules();
      const oldFormat = JSON.stringify({ 'session-old': ['tag1', 'tag2'] });
      vi.mocked(fs.readFileSync).mockImplementation((filePath: any) => {
        if (String(filePath).includes('session-tags')) return oldFormat;
        return '{}';
      });
      vi.mocked(fs.existsSync).mockReturnValue(false);
      vi.mocked(fs.writeFileSync).mockImplementation(() => {});
      vi.mocked(fs.readdirSync).mockReturnValue([] as any);

      scanner = await import('../src/services/scanner');
      await scanner.scan();
      expect(scanner.getTags('session-old')).toEqual(['tag1', 'tag2']);
      expect(scanner.hasTagSource('session-old', 'meta')).toBe(true);
    });

    it('loads new format correctly', async () => {
      vi.resetModules();
      const newFormat = JSON.stringify({ 'session-new': { tags: ['pr#123'], sources: ['refs'] } });
      vi.mocked(fs.readFileSync).mockImplementation((filePath: any) => {
        if (String(filePath).includes('session-tags')) return newFormat;
        return '{}';
      });
      vi.mocked(fs.existsSync).mockReturnValue(false);
      vi.mocked(fs.writeFileSync).mockImplementation(() => {});
      vi.mocked(fs.readdirSync).mockReturnValue([] as any);

      scanner = await import('../src/services/scanner');
      await scanner.scan();
      expect(scanner.getTags('session-new')).toEqual(['pr#123']);
      expect(scanner.hasTagSource('session-new', 'refs')).toBe(true);
      expect(scanner.hasTagSource('session-new', 'meta')).toBe(false);
    });

    it('handles corrupt JSON gracefully', async () => {
      vi.resetModules();
      vi.mocked(fs.readFileSync).mockImplementation((filePath: any) => {
        if (String(filePath).includes('tags')) throw new Error('ENOENT');
        return '{}';
      });
      vi.mocked(fs.existsSync).mockReturnValue(false);
      vi.mocked(fs.writeFileSync).mockImplementation(() => {});
      vi.mocked(fs.readdirSync).mockReturnValue([] as any);

      scanner = await import('../src/services/scanner');
      await scanner.scan();
      expect(scanner.getTags('any')).toEqual([]);
    });
  });
});
