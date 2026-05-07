import path from 'path';
import os from 'os';

export const CLAUDE_DIR = path.join(os.homedir(), '.claude');
export const PROJECTS_DIR = path.join(CLAUDE_DIR, 'projects');
export const FILE_HISTORY_DIR = path.join(CLAUDE_DIR, 'file-history');

export function projectDirToDisplayName(dirName: string, originalPath?: string): string {
  if (originalPath) {
    const home = os.homedir();
    if (originalPath.startsWith(home)) {
      return '~' + originalPath.slice(home.length);
    }
    return originalPath;
  }
  const restored = '/' + dirName.slice(1).replace(/-/g, '/');
  const home = os.homedir();
  if (restored.startsWith(home)) {
    return '~' + restored.slice(home.length);
  }
  return restored;
}

export function sessionsIndexPath(dirName: string): string {
  return path.join(PROJECTS_DIR, dirName, 'sessions-index.json');
}

export function sessionJsonlPath(dirName: string, sessionId: string): string {
  return path.join(PROJECTS_DIR, dirName, `${sessionId}.jsonl`);
}

export function sessionSubagentsDir(dirName: string, sessionId: string): string {
  return path.join(PROJECTS_DIR, dirName, sessionId);
}

export function sessionFileHistoryDir(sessionId: string): string {
  return path.join(FILE_HISTORY_DIR, sessionId);
}
