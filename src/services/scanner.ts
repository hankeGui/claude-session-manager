import fs from 'fs';
import path from 'path';
import { PROJECTS_DIR, projectDirToDisplayName, sessionsIndexPath } from '../utils/paths';
import { removeSummary } from './ai-scanner';
import type { Project, Session, ScannerData } from '../types';

let data: ScannerData = { projects: [] };

const TITLES_FILE = path.join(__dirname, '..', '..', 'session-titles.json');
const FAVORITES_FILE = path.join(__dirname, '..', '..', 'session-favorites.json');
const TAGS_FILE = path.join(__dirname, '..', '..', 'session-tags.json');

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

function loadFavorites(): Record<string, boolean> {
  try {
    return JSON.parse(fs.readFileSync(FAVORITES_FILE, 'utf-8'));
  } catch {
    return {};
  }
}

function saveFavorites(favorites: Record<string, boolean>): void {
  fs.writeFileSync(FAVORITES_FILE, JSON.stringify(favorites, null, 2));
}

// --- Tag system ---
// Storage format: { sessionId: { tags: string[], sources: string[] } }
// sources tracks which extraction types have run (e.g. "meta", "refs", "search")

interface TagEntry {
  tags: string[];
  sources: string[];
  contentHash?: string;
}

let tagStore: Record<string, TagEntry> = {};

function loadTags(): void {
  try {
    const raw = JSON.parse(fs.readFileSync(TAGS_FILE, 'utf-8'));
    // Migrate old format: { sessionId: string[] } → new format
    tagStore = {};
    for (const [key, value] of Object.entries(raw)) {
      if (Array.isArray(value)) {
        // Old format — migrate
        tagStore[key] = { tags: value as string[], sources: ['meta'] };
      } else if (value && typeof value === 'object') {
        tagStore[key] = value as TagEntry;
      }
    }
  } catch {
    tagStore = {};
  }
}

function saveTags(): void {
  fs.writeFileSync(TAGS_FILE, JSON.stringify(tagStore, null, 2));
}

export function getTags(sessionId: string): string[] {
  return tagStore[sessionId]?.tags || [];
}

/** Check if a specific extraction source has already run for this session (and content hasn't changed) */
export function hasTagSource(sessionId: string, source: string): boolean {
  const entry = tagStore[sessionId];
  if (!entry?.sources?.includes(source)) return false;
  // If contentHash is tracked, verify it still matches
  if (entry.contentHash) {
    const found = getSessionById(sessionId);
    if (found && found.session.contentHash && entry.contentHash !== found.session.contentHash) {
      return false; // content changed, force re-extraction
    }
  }
  return true;
}

/** Mark an extraction source as done for this session, storing current contentHash */
export function markTagSource(sessionId: string, source: string): void {
  if (!tagStore[sessionId]) tagStore[sessionId] = { tags: [], sources: [] };
  if (!tagStore[sessionId].sources.includes(source)) {
    tagStore[sessionId].sources.push(source);
  }
  // Store current contentHash for future invalidation checks
  const found = getSessionById(sessionId);
  if (found) tagStore[sessionId].contentHash = found.session.contentHash;
}

const IGNORE_TAGS = new Set(['head', 'master', 'main', 'users', 'home', 'tmp', 'var', 'opt', 'usr']);

function isUsefulTag(tag: string): boolean {
  if (!tag || tag.length < 2) return false;
  const lower = tag.toLowerCase();
  if (IGNORE_TAGS.has(lower)) return false;
  if (/^[A-Z]\d+$/i.test(tag)) return false;
  return true;
}

/**
 * Add a single tag. Does NOT save to disk — call flushTags() after batch ops.
 */
function addTagInternal(sessionId: string, tag: string): boolean {
  const normalized = tag.trim();
  if (!normalized) return false;
  if (!tagStore[sessionId]) tagStore[sessionId] = { tags: [], sources: [] };
  if (tagStore[sessionId].tags.includes(normalized)) return false;
  tagStore[sessionId].tags.push(normalized);
  return true;
}

/**
 * Add tag(s) for a session + mark source + persist. Public API for external callers.
 */
export function addTag(sessionId: string, tag: string): void {
  if (addTagInternal(sessionId, tag)) {
    saveTags();
    syncSessionTags(sessionId);
  }
}

export function addTags(sessionId: string, newTags: string[], source?: string): void {
  let changed = false;
  for (const t of newTags) {
    if (addTagInternal(sessionId, t)) changed = true;
  }
  if (source) markTagSource(sessionId, source);
  if (changed || source) {
    saveTags();
    syncSessionTags(sessionId);
  }
}

/** Sync in-memory session object's tags field */
function syncSessionTags(sessionId: string): void {
  for (const project of data.projects) {
    const session = project.sessions.find(s => s.sessionId === sessionId);
    if (session) {
      session.tags = tagStore[sessionId]?.tags || [];
      break;
    }
  }
}

/**
 * Extract meta tags (project path + git branch) for all sessions.
 * Runs at scan time, skips sessions where "meta" source is already done.
 */
function extractMetaTags(): void {
  let changed = false;
  for (const project of data.projects) {
    for (const session of project.sessions) {
      if (session.isEmpty) continue;
      if (hasTagSource(session.sessionId, 'meta')) continue;

      const projectPath = project.projectPath || '';
      if (projectPath) {
        const lastSegment = projectPath.split('/').filter(Boolean).pop();
        if (lastSegment && isUsefulTag(lastSegment)) {
          if (addTagInternal(session.sessionId, lastSegment)) changed = true;
        }
      }

      if (session.gitBranch && isUsefulTag(session.gitBranch)) {
        if (addTagInternal(session.sessionId, session.gitBranch)) changed = true;
      }

      markTagSource(session.sessionId, 'meta');
      session.tags = tagStore[session.sessionId]?.tags || [];
      changed = true; // at minimum we marked the source
    }
  }
  if (changed) saveTags();
}

/** Remove all tag data for a session */
export function removeTags(sessionId: string): void {
  if (tagStore[sessionId]) {
    delete tagStore[sessionId];
    saveTags();
  }
}

/** Flush pending tag writes (for batch callers that use addTagInternal) */
export function flushTags(): void { saveTags(); }

export function clearTitles(): void {
  saveTitles({});
  for (const project of data.projects) {
    for (const session of project.sessions) {
      session.customTitle = null;
    }
  }
}

export function clearTags(): void {
  tagStore = {};
  saveTags();
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

export function setFavorite(sessionId: string, isFavorite: boolean): void {
  const favorites = loadFavorites();
  if (isFavorite) {
    favorites[sessionId] = true;
  } else {
    delete favorites[sessionId];
  }
  saveFavorites(favorites);
  for (const project of data.projects) {
    const session = project.sessions.find(s => s.sessionId === sessionId);
    if (session) {
      session.isFavorite = isFavorite;
      break;
    }
  }
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.jsonl$/;

// Strip system noise from session text:
// 1. Remove XML-tagged blocks with content (e.g. <system-reminder>...</system-reminder>)
// 2. Remove self-closing/orphan tags
// 3. Remove known system caveat prefixes
// 4. Remove slash commands that aren't real prompts
function stripTags(text: string): string {
  let cleaned = text;
  // Remove full tagged blocks (tag + content + closing tag)
  cleaned = cleaned.replace(/<(local-command-caveat|system-reminder|command-output|tool-use|user-prompt-submit-hook)[^>]*>[\s\S]*?<\/\1>/gi, '');
  // Remove any remaining opening/closing tags
  cleaned = cleaned.replace(/<\/?[a-zA-Z][a-zA-Z0-9_-]*(?:\s[^>]*)?>/g, '');
  // Remove "Caveat: The messages below were generated..." system prefix
  cleaned = cleaned.replace(/Caveat:\s*The messages below were generated by the user while running local commands\.[^.]*/gi, '');
  // Remove "DO NOT respond to these messages..." continuation
  cleaned = cleaned.replace(/DO NOT respond to these messages or attempt to.*?(?:\.|$)/gi, '');
  // Collapse whitespace
  cleaned = cleaned.replace(/\s{2,}/g, ' ').trim();
  return cleaned;
}

// Check if a message is a system/slash command or exit signal that shouldn't be used as firstPrompt
function isSystemCommand(text: string): boolean {
  const trimmed = text.trim().toLowerCase();
  // Single or double slash commands
  if (/^\/{1,2}(clear|exit|quit|help|compact|config|status|doctor|login|logout|mcp|memory|review|init)\b/.test(trimmed)) return true;
  // Exit signals: "→ Goodbye!", "Goodbye!", "No response requested."
  if (/^(→\s*)?goodbye!?$/i.test(trimmed)) return true;
  if (/^no response requested\.?$/i.test(trimmed)) return true;
  return false;
}

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
  const fp = (entry.firstPrompt || '').trim();
  if (/^\/{1,2}clear$/i.test(fp)) return 'Cleared';
  if (/^\/{1,2}exit$/i.test(fp)) return 'Exited immediately';
  if (/^(→\s*)?goodbye!?$/i.test(fp)) return 'Exited immediately';
  if (/^no response requested\.?$/i.test(fp)) return 'Exited immediately';
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

      if (obj.type === 'user') {
        // Always capture metadata from first user message
        if (!meta.created && obj.timestamp) meta.created = obj.timestamp;
        if (!meta.gitBranch && obj.gitBranch) meta.gitBranch = obj.gitBranch;
        if (!meta.cwd && obj.cwd) meta.cwd = obj.cwd;

        // Skip system commands for firstPrompt, use next meaningful message
        if (!meta.firstPrompt && obj.message?.content) {
          const msgContent = typeof obj.message.content === 'string'
            ? obj.message.content
            : obj.message.content.filter((b: any) => b.type === 'text').map((b: any) => b.text).join(' ');
          const cleaned = stripTags(msgContent).slice(0, 200);
          if (cleaned && !isSystemCommand(cleaned)) meta.firstPrompt = cleaned;
        }
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
  const favorites = loadFavorites();
  loadTags();

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
      let contentHash = '';
      try {
        const stat = fs.statSync(jsonlPath);
        diskSize = stat.size;
        contentHash = `${stat.size}:${Math.floor(stat.mtimeMs)}`;
      } catch {}

      const indexed = indexedMap.get(sessionId);
      if (indexed) {
        const emptyReason = getEmptyReason(indexed);
        sessions.push({
          sessionId,
          customTitle: titles[sessionId] || null,
          firstPrompt: stripTags(indexed.firstPrompt || ''),
          summary: stripTags(indexed.summary || '') || null,
          messageCount: indexed.messageCount || 0,
          created: indexed.created || '',
          modified: indexed.modified || '',
          gitBranch: indexed.gitBranch || null,
          isEmpty: !!emptyReason,
          emptyReason,
          diskSize,
          dirName,
          isFavorite: !!favorites[sessionId],
          tags: getTags(sessionId),
          contentHash,
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
          isFavorite: !!favorites[sessionId],
          tags: getTags(sessionId),
          contentHash,
        });
      }

      indexedMap.delete(sessionId);
    }

    for (const [sessionId, entry] of indexedMap) {
      sessions.push({
        sessionId,
        customTitle: titles[sessionId] || null,
        firstPrompt: stripTags(entry.firstPrompt || ''),
        summary: stripTags(entry.summary || '') || null,
        messageCount: entry.messageCount || 0,
        created: entry.created || '',
        modified: entry.modified || '',
        gitBranch: entry.gitBranch || null,
        isEmpty: true,
        emptyReason: 'No session file',
        diskSize: 0,
        dirName,
        isFavorite: !!favorites[sessionId],
        tags: getTags(sessionId),
        contentHash: '',
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

  // Extract meta tags (path + branch) for sessions not yet processed
  extractMetaTags();
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
      // Clean up persisted metadata
      const titles = loadTitles();
      if (titles[sessionId]) { delete titles[sessionId]; saveTitles(titles); }
      const favorites = loadFavorites();
      if (favorites[sessionId]) { delete favorites[sessionId]; saveFavorites(favorites); }
      removeTags(sessionId);
      removeSummary(sessionId);
      return true;
    }
  }
  return false;
}
