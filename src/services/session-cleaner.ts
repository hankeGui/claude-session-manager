import fs from 'fs';
import path from 'path';
import { sessionJsonlPath, sessionSubagentsDir, sessionFileHistoryDir, sessionsIndexPath } from '../utils/paths';
import * as scanner from './scanner';

function deleteDirRecursive(dirPath: string): boolean {
  if (fs.existsSync(dirPath)) {
    fs.rmSync(dirPath, { recursive: true, force: true });
    return true;
  }
  return false;
}

function getDirSize(dirPath: string): number {
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

export async function deleteSession(sessionId: string): Promise<{ success: boolean; freedBytes?: number; error?: string }> {
  const found = scanner.getSessionById(sessionId);
  if (!found) {
    return { success: false, error: 'Session not found' };
  }

  const { session } = found;
  const dirName = session.dirName;
  let freedBytes = 0;

  const jsonlPath = sessionJsonlPath(dirName, sessionId);
  if (fs.existsSync(jsonlPath)) {
    const stat = fs.statSync(jsonlPath);
    freedBytes += stat.size;
    fs.unlinkSync(jsonlPath);
  }

  const subagentsDir = sessionSubagentsDir(dirName, sessionId);
  if (fs.existsSync(subagentsDir)) {
    freedBytes += getDirSize(subagentsDir);
    deleteDirRecursive(subagentsDir);
  }

  const fileHistDir = sessionFileHistoryDir(sessionId);
  if (fs.existsSync(fileHistDir)) {
    freedBytes += getDirSize(fileHistDir);
    deleteDirRecursive(fileHistDir);
  }

  const indexPath = sessionsIndexPath(dirName);
  if (fs.existsSync(indexPath)) {
    try {
      const index = JSON.parse(fs.readFileSync(indexPath, 'utf-8'));
      index.entries = index.entries.filter((e: any) => e.sessionId !== sessionId);
      fs.writeFileSync(indexPath, JSON.stringify(index, null, 2));
    } catch (err: any) {
      console.error('Failed to update sessions-index.json:', err.message);
    }
  }

  scanner.removeSession(sessionId);

  return { success: true, freedBytes };
}

export async function batchDelete(sessionIds: string[]): Promise<{ deleted: string[]; errors: { id: string; error?: string }[]; totalFreedBytes: number }> {
  const results = { deleted: [] as string[], errors: [] as { id: string; error?: string }[], totalFreedBytes: 0 };

  for (const id of sessionIds) {
    const result = await deleteSession(id);
    if (result.success) {
      results.deleted.push(id);
      results.totalFreedBytes += result.freedBytes || 0;
    } else {
      results.errors.push({ id, error: result.error });
    }
  }

  return results;
}
