import { describe, it, expect } from 'vitest';
import os from 'os';
import path from 'path';
import { projectDirToDisplayName, sessionsIndexPath, sessionJsonlPath, sessionSubagentsDir, sessionFileHistoryDir, PROJECTS_DIR, CLAUDE_DIR } from '../src/utils/paths';

describe('paths', () => {
  const home = os.homedir();

  describe('CLAUDE_DIR / PROJECTS_DIR', () => {
    it('should point to ~/.claude and ~/.claude/projects', () => {
      expect(CLAUDE_DIR).toBe(path.join(home, '.claude'));
      expect(PROJECTS_DIR).toBe(path.join(home, '.claude', 'projects'));
    });
  });

  describe('projectDirToDisplayName', () => {
    it('returns originalPath shortened with ~ when under home', () => {
      const result = projectDirToDisplayName('some-dir', `${home}/my-project`);
      expect(result).toBe('~/my-project');
    });

    it('returns originalPath as-is when not under home', () => {
      const result = projectDirToDisplayName('some-dir', '/opt/project');
      expect(result).toBe('/opt/project');
    });

    it('converts dirName to path when no originalPath given', () => {
      const result = projectDirToDisplayName('-Users-test-project');
      expect(result).toBe('/Users/test/project');
    });

    it('shortens dirName-derived path with ~ when under home', () => {
      const dirName = '-' + home.slice(1).replace(/\//g, '-') + '-myrepo';
      const result = projectDirToDisplayName(dirName);
      expect(result).toBe('~/myrepo');
    });
  });

  describe('sessionsIndexPath', () => {
    it('returns correct path', () => {
      const result = sessionsIndexPath('my-project');
      expect(result).toBe(path.join(PROJECTS_DIR, 'my-project', 'sessions-index.json'));
    });
  });

  describe('sessionJsonlPath', () => {
    it('returns correct path', () => {
      const result = sessionJsonlPath('my-project', 'abc-123');
      expect(result).toBe(path.join(PROJECTS_DIR, 'my-project', 'abc-123.jsonl'));
    });
  });

  describe('sessionSubagentsDir', () => {
    it('returns correct path', () => {
      const result = sessionSubagentsDir('my-project', 'abc-123');
      expect(result).toBe(path.join(PROJECTS_DIR, 'my-project', 'abc-123'));
    });
  });

  describe('sessionFileHistoryDir', () => {
    it('returns correct path', () => {
      const result = sessionFileHistoryDir('abc-123');
      expect(result).toContain('file-history/abc-123');
    });
  });
});
