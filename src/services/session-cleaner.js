const fs = require('fs');
const path = require('path');
const { sessionJsonlPath, sessionSubagentsDir, sessionFileHistoryDir, sessionsIndexPath } = require('../utils/paths');
const scanner = require('./scanner');

function deleteDirRecursive(dirPath) {
  if (fs.existsSync(dirPath)) {
    fs.rmSync(dirPath, { recursive: true, force: true });
    return true;
  }
  return false;
}

async function deleteSession(sessionId) {
  const found = scanner.getSessionById(sessionId);
  if (!found) {
    return { success: false, error: 'Session not found' };
  }

  const { session, project } = found;
  const dirName = session.dirName;
  let freedBytes = 0;

  // 1. Delete JSONL file
  const jsonlPath = sessionJsonlPath(dirName, sessionId);
  if (fs.existsSync(jsonlPath)) {
    const stat = fs.statSync(jsonlPath);
    freedBytes += stat.size;
    fs.unlinkSync(jsonlPath);
  }

  // 2. Delete subagents directory
  const subagentsDir = sessionSubagentsDir(dirName, sessionId);
  if (fs.existsSync(subagentsDir)) {
    const size = getDirSize(subagentsDir);
    freedBytes += size;
    deleteDirRecursive(subagentsDir);
  }

  // 3. Delete file-history directory
  const fileHistDir = sessionFileHistoryDir(sessionId);
  if (fs.existsSync(fileHistDir)) {
    const size = getDirSize(fileHistDir);
    freedBytes += size;
    deleteDirRecursive(fileHistDir);
  }

  // 4. Update sessions-index.json
  const indexPath = sessionsIndexPath(dirName);
  if (fs.existsSync(indexPath)) {
    try {
      const index = JSON.parse(fs.readFileSync(indexPath, 'utf-8'));
      index.entries = index.entries.filter(e => e.sessionId !== sessionId);
      fs.writeFileSync(indexPath, JSON.stringify(index, null, 2));
    } catch (err) {
      console.error('Failed to update sessions-index.json:', err.message);
    }
  }

  // 5. Remove from in-memory data
  scanner.removeSession(sessionId);

  return { success: true, freedBytes };
}

async function batchDelete(sessionIds) {
  const results = { deleted: [], errors: [], totalFreedBytes: 0 };

  for (const id of sessionIds) {
    const result = await deleteSession(id);
    if (result.success) {
      results.deleted.push(id);
      results.totalFreedBytes += result.freedBytes;
    } else {
      results.errors.push({ id, error: result.error });
    }
  }

  return results;
}

function getDirSize(dirPath) {
  let size = 0;
  try {
    const entries = fs.readdirSync(dirPath, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dirPath, entry.name);
      if (entry.isFile()) {
        size += fs.statSync(fullPath).size;
      } else if (entry.isDirectory()) {
        size += getDirSize(fullPath);
      }
    }
  } catch {}
  return size;
}

module.exports = { deleteSession, batchDelete };
