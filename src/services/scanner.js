const fs = require('fs');
const path = require('path');
const readline = require('readline');
const { PROJECTS_DIR, CLAUDE_DIR, projectDirToDisplayName, sessionsIndexPath, sessionJsonlPath } = require('../utils/paths');

let data = { projects: [] };

// Custom titles stored in a local JSON file
const TITLES_FILE = path.join(__dirname, '..', '..', 'session-titles.json');

function loadTitles() {
  try {
    return JSON.parse(fs.readFileSync(TITLES_FILE, 'utf-8'));
  } catch {
    return {};
  }
}

function saveTitles(titles) {
  fs.writeFileSync(TITLES_FILE, JSON.stringify(titles, null, 2));
}

function getTitle(sessionId) {
  const titles = loadTitles();
  return titles[sessionId] || '';
}

function setTitle(sessionId, title) {
  const titles = loadTitles();
  if (title) {
    titles[sessionId] = title;
  } else {
    delete titles[sessionId];
  }
  saveTitles(titles);
  // Update in-memory data
  for (const project of data.projects) {
    const session = project.sessions.find(s => s.sessionId === sessionId);
    if (session) {
      session.customTitle = title || '';
      break;
    }
  }
}

// UUID pattern for session filenames
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.jsonl$/;

function isEmptySession(entry) {
  if (!entry.messageCount || entry.messageCount <= 1) return true;
  if (!entry.firstPrompt || entry.firstPrompt === 'No prompt') return true;
  if (entry.summary === 'User Exited CLI Session' || entry.summary === 'User Exited Claude Code CLI Session') return true;
  if (entry.firstPrompt && entry.firstPrompt.trim() === '/clear') return true;
  return false;
}

// Extract metadata from JSONL file by reading first few meaningful lines
function extractMetaFromJsonl(filePath) {
  const meta = {
    firstPrompt: '',
    messageCount: 0,
    created: null,
    modified: null,
    gitBranch: '',
    cwd: '',
  };

  let content;
  try {
    // Read first 50KB to get metadata quickly (enough for first few messages)
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
    let obj;
    try {
      obj = JSON.parse(line);
    } catch {
      continue;
    }

    if (obj.type === 'user' || obj.type === 'assistant') {
      meta.messageCount++;

      if (obj.type === 'user' && !meta.firstPrompt) {
        if (obj.message && obj.message.content) {
          const content = typeof obj.message.content === 'string'
            ? obj.message.content
            : obj.message.content.filter(b => b.type === 'text').map(b => b.text).join(' ');
          meta.firstPrompt = content.slice(0, 200);
        }
        if (obj.timestamp) meta.created = obj.timestamp;
        if (obj.gitBranch) meta.gitBranch = obj.gitBranch;
        if (obj.cwd) meta.cwd = obj.cwd;
      }

      if (obj.timestamp) meta.modified = obj.timestamp;
    }
  }

  // For full message count, do a quick scan of the entire file
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

    // Get modified time from last message
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

async function scan() {
  const projects = [];
  const titles = loadTitles();

  let dirs;
  try {
    dirs = fs.readdirSync(PROJECTS_DIR, { withFileTypes: true })
      .filter(d => d.isDirectory())
      .map(d => d.name);
  } catch (err) {
    console.error('Cannot read projects dir:', err.message);
    data = { projects: [] };
    return;
  }

  for (const dirName of dirs) {
    const projectDir = path.join(PROJECTS_DIR, dirName);

    // Collect all JSONL session files in this directory
    let jsonlFiles;
    try {
      jsonlFiles = fs.readdirSync(projectDir)
        .filter(f => UUID_RE.test(f));
    } catch {
      continue;
    }

    if (jsonlFiles.length === 0) continue;

    // Read index if available
    const indexPath = sessionsIndexPath(dirName);
    let index = { entries: [], originalPath: '' };
    try {
      index = JSON.parse(fs.readFileSync(indexPath, 'utf-8'));
      if (!index.entries) index.entries = [];
    } catch {}

    // Build a map of indexed sessions
    const indexedMap = new Map();
    for (const entry of index.entries) {
      if (!entry.isSidechain) {
        indexedMap.set(entry.sessionId, entry);
      }
    }

    const sessions = [];

    for (const file of jsonlFiles) {
      const sessionId = file.replace('.jsonl', '');
      const jsonlPath = path.join(projectDir, file);

      let diskSize = 0;
      try {
        diskSize = fs.statSync(jsonlPath).size;
      } catch {}

      const indexed = indexedMap.get(sessionId);
      if (indexed) {
        // Use index metadata
        sessions.push({
          sessionId,
          customTitle: titles[sessionId] || '',
          firstPrompt: indexed.firstPrompt || '',
          summary: indexed.summary || '',
          messageCount: indexed.messageCount || 0,
          created: indexed.created || null,
          modified: indexed.modified || null,
          gitBranch: indexed.gitBranch || '',
          isEmpty: isEmptySession(indexed),
          diskSize,
          fileExists: true,
          dirName,
        });
      } else {
        // Extract metadata from JSONL file
        const meta = extractMetaFromJsonl(jsonlPath);
        sessions.push({
          sessionId,
          customTitle: titles[sessionId] || '',
          firstPrompt: meta.firstPrompt,
          summary: '',
          messageCount: meta.messageCount,
          created: meta.created,
          modified: meta.modified,
          gitBranch: meta.gitBranch,
          isEmpty: isEmptySession({ firstPrompt: meta.firstPrompt, messageCount: meta.messageCount }),
          diskSize,
          fileExists: true,
          dirName,
        });
      }

      indexedMap.delete(sessionId);
    }

    // Also add orphan index entries (no JSONL file)
    for (const [sessionId, entry] of indexedMap) {
      sessions.push({
        sessionId,
        customTitle: titles[sessionId] || '',
        firstPrompt: entry.firstPrompt || '',
        summary: entry.summary || '',
        messageCount: entry.messageCount || 0,
        created: entry.created || null,
        modified: entry.modified || null,
        gitBranch: entry.gitBranch || '',
        isEmpty: true,
        diskSize: 0,
        fileExists: false,
        dirName,
      });
    }

    // Determine project path from index or from session metadata
    let projectPath = index.originalPath || '';
    if (!projectPath && sessions.length > 0) {
      // Try to derive from cwd in first session's JSONL
      const firstFile = path.join(projectDir, jsonlFiles[0]);
      const meta = extractMetaFromJsonl(firstFile);
      projectPath = meta.cwd || '';
    }

    projects.push({
      dirName,
      displayName: projectDirToDisplayName(dirName, projectPath),
      projectPath,
      sessionCount: sessions.length,
      sessions,
    });
  }

  projects.sort((a, b) => a.displayName.localeCompare(b.displayName));
  data = { projects };
}

function getData() {
  return data;
}

function getProjectByDir(dirName) {
  return data.projects.find(p => p.dirName === dirName);
}

function getSessionById(sessionId) {
  for (const project of data.projects) {
    const session = project.sessions.find(s => s.sessionId === sessionId);
    if (session) return { session, project };
  }
  return null;
}

function removeSession(sessionId) {
  for (const project of data.projects) {
    const idx = project.sessions.findIndex(s => s.sessionId === sessionId);
    if (idx !== -1) {
      project.sessions.splice(idx, 1);
      project.sessionCount = project.sessions.length;
      return true;
    }
  }
  return false;
}

module.exports = { scan, getData, getProjectByDir, getSessionById, removeSession, setTitle };
