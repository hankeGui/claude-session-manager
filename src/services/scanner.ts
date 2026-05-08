import fs from 'fs';
import path from 'path';
import { PROJECTS_DIR, projectDirToDisplayName, sessionsIndexPath } from '../utils/paths';
import type { Project, Session, ScannerData } from '../types';

let data: ScannerData = { projects: [] };

const TITLES_FILE = path.join(__dirname, '..', '..', 'session-titles.json');

function loadTitles(): Record<string, string> {
  try {
    return JSON.parse(fs.readFileSync(TITLES_FILE, 'utf-8'));
  } catch {
    return {};
  }
}

function saveTitles(titles: Record<string, string>): void {
  fs.writeFileSync(TITLES_FILE, JSON.stringify(titles, null, 2));
}

export function setTitle(sessionId: string, title: string): void {
  const titles = loadTitles();
  if (title) {
    titles[sessionId] = title;
  } else {
    delete titles[sessionId];
  }
  saveTitles(titles);
  for (const project of data.projects) {
    const session = project.sessions.find(s => s.sessionId === sessionId);
    if (session) {
      session.customTitle = title || null;
      break;
    }
  }
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.jsonl$/;

interface SessionMeta {
  firstPrompt: string;
  messageCount: number;
  created: string | null;
  modified: string | null;
  gitBranch: string;
  cwd: string;
}

function getEmptyReason(entry: { firstPrompt?: string; messageCount?: number; summary?: string }): string | null {
  if (!entry.messageCount || entry.messageCount <= 1) return 'No conversation';
  if (!entry.firstPrompt || entry.firstPrompt === 'No prompt') return 'No prompt entered';
  if (entry.summary === 'User Exited CLI Session' || entry.summary === 'User Exited Claude Code CLI Session') return 'Exited immediately';
  if (entry.firstPrompt && entry.firstPrompt.trim() === '/clear') return 'Cleared';
  return null;
}

function extractMetaFromJsonl(filePath: string): SessionMeta {
  const meta: SessionMeta = {
    firstPrompt: '',
    messageCount: 0,
    created: null,
    modified: null,
    gitBranch: '',
    cwd: '',
  };

  let content: string;
  try {
    const fd = fs.openSync(filePath, 'r');
    const buf = Buffer.alloc(50 * 1024);
    const bytesRead = fs.readSync(fd, buf, 0, buf.length, 0);
    content = buf.toString('utf-8', 0, bytesRead);
    fs.closeSync(fd);
  } catch {
    return meta;
  }

  const lines = content.split('\n').filter(l => l.trim());

  for (const line of lines) {
    let obj: any;
    try {
      obj = JSON.parse(line);
    } catch {
      continue;
    }

    if (obj.type === 'user' || obj.type === 'assistant') {
      meta.messageCount++;

      if (obj.type === 'user' && !meta.firstPrompt) {
        if (obj.message?.content) {
          const msgContent = typeof obj.message.content === 'string'
            ? obj.message.content
            : obj.message.content.filter((b: any) => b.type === 'text').map((b: any) => b.text).join(' ');
          meta.firstPrompt = msgContent.slice(0, 200);
        }
        if (obj.timestamp) meta.created = obj.timestamp;
        if (obj.gitBranch) meta.gitBranch = obj.gitBranch;
        if (obj.cwd) meta.cwd = obj.cwd;
      }

      if (obj.timestamp) meta.modified = obj.timestamp;
    }
  }

  try {
    const full = fs.readFileSync(filePath, 'utf-8');
    const allLines = full.split('\n');
    let totalMsgs = 0;
    for (const line of allLines) {
      if (line.includes('"type":"user"') || line.includes('"type":"assistant"')) {
        totalMsgs++;
      }
    }
    meta.messageCount = totalMsgs;

    for (let i = allLines.length - 1; i >= 0; i--) {
      const l = allLines[i].trim();
      if (!l) continue;
      try {
        const obj = JSON.parse(l);
        if ((obj.type === 'user' || obj.type === 'assistant') && obj.timestamp) {
          meta.modified = obj.timestamp;
          break;
        }
      } catch {}
    }
  } catch {}

  return meta;
}

export async function scan(): Promise<void> {
  const projects: Project[] = [];
  const titles = loadTitles();

  let dirs: string[];
  try {
    dirs = fs.readdirSync(PROJECTS_DIR, { withFileTypes: true })
      .filter(d => d.isDirectory())
      .map(d => d.name);
  } catch (err: any) {
    console.error('Cannot read projects dir:', err.message);
    data = { projects: [] };
    return;
  }

  for (const dirName of dirs) {
    const projectDir = path.join(PROJECTS_DIR, dirName);

    let jsonlFiles: string[];
    try {
      jsonlFiles = fs.readdirSync(projectDir).filter(f => UUID_RE.test(f));
    } catch {
      continue;
    }

    if (jsonlFiles.length === 0) continue;

    const indexPath = sessionsIndexPath(dirName);
    let index: { entries: any[]; originalPath: string } = { entries: [], originalPath: '' };
    try {
      index = JSON.parse(fs.readFileSync(indexPath, 'utf-8'));
      if (!index.entries) index.entries = [];
    } catch {}

    const indexedMap = new Map<string, any>();
    for (const entry of index.entries) {
      if (!entry.isSidechain) {
        indexedMap.set(entry.sessionId, entry);
      }
    }

    const sessions: Session[] = [];

    for (const file of jsonlFiles) {
      const sessionId = file.replace('.jsonl', '');
      const jsonlPath = path.join(projectDir, file);

      let diskSize = 0;
      try {
        diskSize = fs.statSync(jsonlPath).size;
      } catch {}

      const indexed = indexedMap.get(sessionId);
      if (indexed) {
        const emptyReason = getEmptyReason(indexed);
        sessions.push({
          sessionId,
          customTitle: titles[sessionId] || null,
          firstPrompt: indexed.firstPrompt || null,
          summary: indexed.summary || null,
          messageCount: indexed.messageCount || 0,
          created: indexed.created || '',
          modified: indexed.modified || '',
          gitBranch: indexed.gitBranch || null,
          isEmpty: !!emptyReason,
          emptyReason,
          diskSize,
          dirName,
        });
      } else {
        const meta = extractMetaFromJsonl(jsonlPath);
        const emptyReason = getEmptyReason({ firstPrompt: meta.firstPrompt, messageCount: meta.messageCount });
        sessions.push({
          sessionId,
          customTitle: titles[sessionId] || null,
          firstPrompt: meta.firstPrompt || null,
          summary: null,
          messageCount: meta.messageCount,
          created: meta.created || '',
          modified: meta.modified || '',
          gitBranch: meta.gitBranch || null,
          isEmpty: !!emptyReason,
          emptyReason,
          diskSize,
          dirName,
        });
      }

      indexedMap.delete(sessionId);
    }

    for (const [sessionId, entry] of indexedMap) {
      sessions.push({
        sessionId,
        customTitle: titles[sessionId] || null,
        firstPrompt: entry.firstPrompt || null,
        summary: entry.summary || null,
        messageCount: entry.messageCount || 0,
        created: entry.created || '',
        modified: entry.modified || '',
        gitBranch: entry.gitBranch || null,
        isEmpty: true,
        emptyReason: 'No session file',
        diskSize: 0,
        dirName,
      });
    }

    let projectPath = index.originalPath || '';
    if (!projectPath && sessions.length > 0) {
      const firstFile = path.join(projectDir, jsonlFiles[0]);
      const meta = extractMetaFromJsonl(firstFile);
      projectPath = meta.cwd || '';
    }

    projects.push({
      dirName,
      displayName: projectDirToDisplayName(dirName, projectPath),
      projectPath,
      sessions,
    });
  }

  projects.sort((a, b) => a.displayName.localeCompare(b.displayName));
  data = { projects };
}

export function getData(): ScannerData {
  return data;
}

export function getProjectByDir(dirName: string): Project | undefined {
  return data.projects.find(p => p.dirName === dirName);
}

export function getSessionById(sessionId: string): { session: Session; project: Project } | null {
  for (const project of data.projects) {
    const session = project.sessions.find(s => s.sessionId === sessionId);
    if (session) return { session, project };
  }
  return null;
}

export function removeSession(sessionId: string): boolean {
  for (const project of data.projects) {
    const idx = project.sessions.findIndex(s => s.sessionId === sessionId);
    if (idx !== -1) {
      project.sessions.splice(idx, 1);
      return true;
    }
  }
  return false;
}
