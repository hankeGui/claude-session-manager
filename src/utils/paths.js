const path = require('path');
const os = require('os');

const CLAUDE_DIR = path.join(os.homedir(), '.claude');
const PROJECTS_DIR = path.join(CLAUDE_DIR, 'projects');
const FILE_HISTORY_DIR = path.join(CLAUDE_DIR, 'file-history');

function projectDirToDisplayName(dirName, originalPath) {
  // Use originalPath if available: /Users/I547149/orca/deepsea -> ~/orca/deepsea
  if (originalPath) {
    const home = os.homedir();
    if (originalPath.startsWith(home)) {
      return '~' + originalPath.slice(home.length);
    }
    return originalPath;
  }
  // Fallback: decode from dirName
  // -Users-I547149-orca-deepsea -> ~/orca/deepsea
  const restored = '/' + dirName.slice(1).replace(/-/g, '/');
  const home = os.homedir();
  if (restored.startsWith(home)) {
    return '~' + restored.slice(home.length);
  }
  return restored;
}

function sessionsIndexPath(dirName) {
  return path.join(PROJECTS_DIR, dirName, 'sessions-index.json');
}

function sessionJsonlPath(dirName, sessionId) {
  return path.join(PROJECTS_DIR, dirName, `${sessionId}.jsonl`);
}

function sessionSubagentsDir(dirName, sessionId) {
  return path.join(PROJECTS_DIR, dirName, sessionId);
}

function sessionFileHistoryDir(sessionId) {
  return path.join(FILE_HISTORY_DIR, sessionId);
}

module.exports = {
  CLAUDE_DIR,
  PROJECTS_DIR,
  FILE_HISTORY_DIR,
  projectDirToDisplayName,
  sessionsIndexPath,
  sessionJsonlPath,
  sessionSubagentsDir,
  sessionFileHistoryDir,
};
