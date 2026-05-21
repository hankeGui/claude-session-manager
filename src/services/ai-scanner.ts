import fs from 'fs';
import path from 'path';
import * as scanner from './scanner';
import { readSessionMessages } from './session-reader';
import { askAi, getClient } from './ai-client';

const PROJECT_DELETED_TAG = 'project-deleted';

const SUMMARIES_FILE = path.join(__dirname, '..', '..', 'session-ai-summaries.json');

interface AiSummaryEntry {
  summary: string;
  generatedAt: string;
  contentHash?: string;
}

let summaries: Record<string, AiSummaryEntry> = {};
let status = {
  running: false,
  cancelled: false,
  phase: 'idle' as 'idle' | 'summary' | 'rename',
  total: 0, done: 0, cached: 0,
  result: null as { summaries: number; titles: number; skipped: number } | null,
  error: null as string | null,
};
let paused = false;
let batchDelay = 100; // ms between batches, increases on 429
let configValid: boolean | null = null; // null = unknown, true = verified, false = failed/unconfigured

function loadSummaries(): void {
  try {
    summaries = JSON.parse(fs.readFileSync(SUMMARIES_FILE, 'utf-8'));
  } catch {
    summaries = {};
  }
}

function saveSummaries(): void {
  const tmp = SUMMARIES_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(summaries, null, 2));
  fs.renameSync(tmp, SUMMARIES_FILE);
}

export function getSummary(sessionId: string): string | null {
  return summaries[sessionId]?.summary || null;
}

export function removeSummary(sessionId: string): void {
  if (summaries[sessionId]) {
    delete summaries[sessionId];
    saveSummaries();
  }
}

export function getStatus() {
  return { ...status, paused, configValid };
}

export function setConfigValid(valid: boolean): void {
  configValid = valid;
}

export function clearSummaries(): void {
  summaries = {};
  saveSummaries();
}

/** Calculate how many sessions need AI processing without starting */
export function getQueueSize(): { summaries: number; titles: number } {
  loadSummaries();
  const data = scanner.getData();
  const recentThreshold = Date.now() - 2 * 60 * 1000; // skip sessions modified within 2 min
  let sCount = 0, tCount = 0;
  for (const project of data.projects) {
    for (const session of project.sessions) {
      if (session.isEmpty || session.messageCount <= 1) continue;
      // Skip actively-used sessions (mtime too recent, will change again soon)
      if (new Date(session.modified).getTime() > recentThreshold) continue;
      const cached = summaries[session.sessionId];
      if (!cached?.summary || cached.contentHash !== session.contentHash) sCount++;
      if (!session.customTitle) tCount++;
    }
  }
  return { summaries: sCount, titles: tCount };
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitWhilePaused(): Promise<void> {
  while (paused) await delay(200);
}

export function pause(): void { paused = true; }
export function resume(): void { paused = false; }

// --- Ref tag extraction (PR numbers, Jira tickets) ---
const PR_RE = /\/pull\/(\d+)/g;
const JIRA_RE = /\/browse\/([A-Z][A-Z0-9]+-\d+)/g;

function extractRefTags(text: string): string[] {
  const found = new Set<string>();
  let m: RegExpExecArray | null;
  PR_RE.lastIndex = 0;
  JIRA_RE.lastIndex = 0;
  while ((m = PR_RE.exec(text)) !== null) found.add(`PR#${m[1]}`);
  while ((m = JIRA_RE.exec(text)) !== null) found.add(m[1]);
  return [...found];
}

/**
 * Extract ref tags (PR/Jira) from session messages.
 * Uses scanner.hasTagSource('refs') to skip already-processed sessions.
 */
async function extractAllRefTags(data: ReturnType<typeof scanner.getData>): Promise<void> {
  const toScan: { sessionId: string; dirName: string }[] = [];
  for (const project of data.projects) {
    // Check if the project directory still exists on disk
    const projectExists = !project.projectPath || fs.existsSync(project.projectPath);
    for (const session of project.sessions) {
      if (session.isEmpty) continue;
      // Update project-deleted tag based on current filesystem state
      const hasDeletedTag = session.tags.includes(PROJECT_DELETED_TAG);
      if (!projectExists && !hasDeletedTag) {
        scanner.addTag(session.sessionId, PROJECT_DELETED_TAG);
      } else if (projectExists && hasDeletedTag) {
        scanner.removeTag(session.sessionId, PROJECT_DELETED_TAG);
      }
      if (scanner.hasTagSource(session.sessionId, 'refs')) continue;
      toScan.push({ sessionId: session.sessionId, dirName: session.dirName });
    }
  }
  if (toScan.length === 0) return;

  let extracted = 0;
  for (const item of toScan) {
    try {
      const msgs = await readSessionMessages(item.dirName, item.sessionId, { limit: 5, offset: 0 });
      const fullText = msgs.messages.map((m) => m.content.slice(0, 500)).join('\n');
      const refTags = extractRefTags(fullText);
      scanner.addTags(item.sessionId, refTags, 'refs');
      extracted += refTags.length;
    } catch {
      // Mark as scanned even on error to avoid retrying broken files
      scanner.markTagSource(item.sessionId, 'refs');
      scanner.flushTags();
    }
  }
  if (extracted > 0) {
    console.log(`Ref tags: extracted ${extracted} from ${toScan.length} sessions`);
  }
}

/** Regenerate summary for a single session (public API) */
export async function regenerateSummary(sessionId: string): Promise<string | null> {
  const found = scanner.getSessionById(sessionId);
  if (!found) return null;
  const { session } = found;
  // Remove old summary
  delete summaries[sessionId];
  saveSummaries();
  // Process with quality model (single operation)
  await processOne({ sessionId, dirName: session.dirName }, 'quality');
  saveSummaries();
  return summaries[sessionId]?.summary || null;
}

async function processOne(item: { sessionId: string; dirName: string }, modelType: 'quality' | 'fast' = 'fast'): Promise<void> {
  try {
    const found = scanner.getSessionById(item.sessionId);
    if (!found) { status.done++; return; }
    const { session: sess, project } = found;

    // Check if we have an existing summary (hash changed → incremental update)
    const existingSummary = summaries[item.sessionId]?.summary;
    const isIncremental = !!existingSummary;

    // For incremental updates, only read recent messages; otherwise read all
    const readLimit = isIncremental ? 20 : 99999;
    const result = await readSessionMessages(item.dirName, item.sessionId, {
      limit: readLimit,
      offset: isIncremental ? Math.max(0, sess.messageCount - 20) : 0,
    });
    if (result.messages.length === 0) { status.done++; return; }

    // Extract PR/Jira ref tags if not already done
    if (!scanner.hasTagSource(item.sessionId, 'refs')) {
      const fullText = result.messages.map((m) => m.content.slice(0, 500)).join('\n');
      const refTags = extractRefTags(fullText);
      scanner.addTags(item.sessionId, refTags, 'refs');
    }

    // Incremental path: use existing summary + recent messages
    if (isIncremental) {
      const recentParts: string[] = [];
      for (const m of result.messages) {
        const role = m.type === 'user' ? 'User' : 'Assistant';
        let text = m.content.replace(/```[\s\S]*?```/g, '[code]').replace(/\n{3,}/g, '\n\n');
        text = m.type === 'user' ? text.slice(0, 400) : (text.length > 400 ? text.slice(-400) : text);
        recentParts.push(`${role}: ${text}`);
      }

      const metaContext = [
        `Project: ${project.displayName}`,
        sess.gitBranch ? `Branch: ${sess.gitBranch}` : null,
        `Messages: ${sess.messageCount}`,
      ].filter(Boolean).join(' | ');

      const prompt = `Here is an existing summary of a coding session, and the latest messages added since that summary was written.

Metadata: ${metaContext}

Existing summary:
---
${existingSummary}
---

Recent messages (latest ${result.messages.length}):
---
${recentParts.join('\n')}
---

Update the summary to incorporate the new work. Keep the same style and language. If the session now covers multiple tasks, use bullet points (each under 30 chars, 4-8 bullets max). If it's still one task, use 2-3 sentences.

Output ONLY the updated summary, nothing else.`;

      const aiResult = await askAiWithRetry(prompt, { maxTokens: 500, model: modelType });
      const summary = aiResult.trim().replace(/^["']|["']$/g, '');
      if (summary) {
        summaries[item.sessionId] = { summary, generatedAt: new Date().toISOString(), contentHash: sess.contentHash };
      }
      status.done++;
      return;
    }

    // Full processing path: sample messages across the session
    const msgs = result.messages;
    const total = msgs.length;
    let sampled: typeof msgs;

    if (total <= 30) {
      sampled = msgs;
    } else {
      // Scale sample count: 30 base + 1 per 50 messages, cap at 60
      const sampleCount = Math.min(60, 30 + Math.floor(total / 50));
      const headCount = Math.min(8, Math.floor(sampleCount * 0.3));
      const tailCount = Math.min(6, Math.floor(sampleCount * 0.2));
      const midCount = sampleCount - headCount - tailCount;

      const first = msgs.slice(0, headCount);
      const last = msgs.slice(-tailCount);

      // Evenly sample from the middle section
      const midStart = headCount;
      const midEnd = total - tailCount;
      const midRange = midEnd - midStart;
      const mid: typeof msgs = [];
      for (let i = 0; i < midCount; i++) {
        const idx = midStart + Math.floor((i * midRange) / midCount);
        mid.push(msgs[idx]);
      }

      sampled = [...first, ...mid, ...last];
    }

    const parts: string[] = [];
    let prevIdx = -1;
    for (const m of sampled) {
      const globalIdx = msgs.indexOf(m);
      if (prevIdx >= 0 && globalIdx - prevIdx > 2) {
        parts.push('...');
      }
      const role = m.type === 'user' ? 'User' : 'Assistant';
      // Strip code blocks and tool output noise for cleaner context
      let text = m.content
        .replace(/```[\s\S]*?```/g, '[code]')
        .replace(/\n{3,}/g, '\n\n');
      // User messages: take beginning (request is at start)
      // Assistant messages: take end (conclusion/summary is at end)
      if (m.type === 'user') {
        text = text.slice(0, 400);
      } else {
        text = text.length > 400 ? text.slice(-400) : text;
      }
      parts.push(`${role}: ${text}`);
      prevIdx = globalIdx;
    }
    const msgContext = parts.join('\n');

    // Metadata context
    const metaContext = [
      `Project: ${project.displayName}`,
      sess.gitBranch ? `Branch: ${sess.gitBranch}` : null,
      sess.tags.length ? `Tags: ${sess.tags.join(', ')}` : null,
      `Messages: ${sess.messageCount}`,
    ].filter(Boolean).join(' | ');

    // Adaptive prompt based on session length
    const isLongSession = sess.messageCount > 100;
    const prompt = isLongSession
      ? `Here is a long coding session (${sess.messageCount} messages) between a user and AI assistant. Messages are sampled from different stages of the session.

Metadata: ${metaContext}

Conversation (sampled):
---
${msgContext}
---

This is a LONG session covering MULTIPLE tasks. List the main tasks/features worked on (use bullet points, same language as conversation):
- Each bullet: one feature/fix/task (keep each under 30 chars)
- Cover ALL stages of the session, not just the beginning or end
- 4-8 bullets total

Output ONLY the bullet list, nothing else.`
      : `Here is a coding session between a user and AI assistant.

Metadata: ${metaContext}

Conversation:
---
${msgContext}
---

Write a concise summary (2-3 sentences, same language as conversation) describing what was specifically done in this session:
- What task/feature/fix was worked on
- What was the outcome

Do NOT describe the project in general terms. Focus on what THIS session accomplished.

Output ONLY the summary, nothing else.`;

    const aiResult = await askAiWithRetry(prompt, { maxTokens: isLongSession ? 500 : 300, model: modelType });
    const summary = aiResult.trim().replace(/^["']|["']$/g, '');

    if (summary) {
      summaries[item.sessionId] = { summary, generatedAt: new Date().toISOString(), contentHash: sess.contentHash };
    }
  } catch (err: any) {
    console.error(`AI scan error [${item.sessionId.slice(0, 8)}]: ${err.message}`);
    throw err; // propagate to batch loop for immediate stop
  }
  status.done++;
}

/** Retry wrapper with exponential backoff for 429 rate limit errors */
async function askAiWithRetry(prompt: string, opts: { maxTokens: number; model?: 'quality' | 'fast' }, maxRetries = 3): Promise<string> {
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await askAi(prompt, { ...opts, model: opts.model || 'fast' });
    } catch (err: any) {
      const is429 = err.message?.includes('429') || err.status === 429;
      if (!is429 || attempt === maxRetries) throw err;
      // Escalate batch delay to prevent further 429s
      batchDelay = Math.min(batchDelay * 2, 30000);
      const backoff = Math.pow(2, attempt + 1) * 5000; // 10s, 20s, 40s
      console.log(`Rate limited, batch delay → ${batchDelay}ms, waiting ${backoff / 1000}s before retry (${attempt + 1}/${maxRetries})...`);
      await delay(backoff);
    }
  }
  throw new Error('unreachable');
}

/**
 * Generate a short title for a session via AI.
 * Prefers cached summary as context, falls back to reading messages.
 * @param useFastModel - true for batch operations (cheaper), false for single operations (better quality)
 */
export async function generateTitle(sessionId: string, useFastModel = false): Promise<string | null> {
  const found = scanner.getSessionById(sessionId);
  if (!found) return null;
  const { session } = found;

  // Build context: prefer cached AI summary, else read messages
  const cached = getSummary(sessionId);
  let context: string;

  if (cached) {
    context = cached;
  } else {
    const msgs = await readSessionMessages(session.dirName, sessionId, { limit: 10, offset: 0 });
    if (msgs.messages.length === 0) return null;
    context = msgs.messages.map((m) => {
      const role = m.type === 'user' ? 'User' : 'Assistant';
      return `${role}: ${m.content.slice(0, 200)}`;
    }).join('\n');
  }

  // Meta hints for richer title
  const metaHints = [
    session.gitBranch ? `branch:${session.gitBranch}` : null,
    session.tags.length ? `tags:${session.tags.slice(0, 3).join(',')}` : null,
  ].filter(Boolean).join(' ');

  const prompt = `Generate a short descriptive title (under 60 chars, same language as conversation) for this coding session.
Include key identifiers if relevant (PR number, feature name, branch).
${metaHints ? `Context hints: ${metaHints}` : ''}

Session content:
${context}

Output ONLY the title, nothing else.`;

  const result = await askAi(prompt, { maxTokens: 80, model: useFastModel ? 'fast' : 'quality' });
  if (!result) return null;
  return result.trim().replace(/^["']|["']$/g, '');
}

async function generateTitleWithRetry(sessionId: string, maxRetries = 3): Promise<string | null> {
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await generateTitle(sessionId, true);
    } catch (err: any) {
      const is429 = err.message?.includes('429') || err.status === 429;
      if (!is429 || attempt === maxRetries) throw err;
      batchDelay = Math.min(batchDelay * 2, 30000);
      const backoff = Math.pow(2, attempt + 1) * 5000;
      console.log(`Rate limited (rename), batch delay → ${batchDelay}ms, waiting ${backoff / 1000}s before retry (${attempt + 1}/${maxRetries})...`);
      await delay(backoff);
    }
  }
  return null;
}

/**
 * Background AI scan: generate summaries for sessions not yet cached.
 * Also extracts ref tags (PR/Jira) as a fast pre-pass.
 */
export async function start(): Promise<void> {
  if (status.running) return; // prevent concurrent runs

  paused = false; // clear any leftover pause state
  status.cancelled = false;
  status.error = null;
  loadSummaries();

  const data = scanner.getData();

  // Fast pre-pass: extract PR/Jira ref tags (pure I/O, no AI)
  await extractAllRefTags(data);

  if (!getClient()) {
    console.log('AI scan skipped: AI not configured');
    configValid = false;
    return;
  }

  configValid = true;
  const queue: { sessionId: string; dirName: string }[] = [];
  const recentThreshold = Date.now() - 2 * 60 * 1000;

  for (const project of data.projects) {
    for (const session of project.sessions) {
      if (session.isEmpty) continue;
      if (session.messageCount <= 1) continue;
      // Skip actively-used sessions (modified within 2 min)
      if (new Date(session.modified).getTime() > recentThreshold) continue;
      // Skip if cached summary exists AND content hasn't changed
      const cached = summaries[session.sessionId];
      if (cached?.summary && cached.contentHash === session.contentHash) continue;
      queue.push({ sessionId: session.sessionId, dirName: session.dirName });
    }
  }

  status.cached = Object.keys(summaries).length;
  status.total = queue.length;
  status.done = 0;
  status.result = null;

  if (queue.length === 0) {
    console.log(`AI scan: all ${status.cached} sessions already cached`);
    // Skip to rename phase
    const titlesDone = await autoRenamePhase(data);
    status.running = false;
    status.phase = 'idle';
    status.result = { summaries: 0, titles: titlesDone, skipped: status.cached };
    return;
  }

  status.running = true;
  status.phase = 'summary';
  console.log(`AI scan started: ${queue.length} sessions to process (${status.cached} cached)`);

  const CONCURRENCY = 3;
  batchDelay = 100;
  for (let i = 0; i < queue.length; i += CONCURRENCY) {
    if (!status.running) break;
    await waitWhilePaused();

    const batch = queue.slice(i, i + CONCURRENCY);
    try {
      await Promise.all(batch.map((item) => processOne(item)));
    } catch (err: any) {
      status.error = err.message || 'AI request failed';
      status.running = false;
      status.phase = 'idle';
      console.error(`AI scan stopped due to error: ${status.error}`);
      break;
    }
    saveSummaries();

    if (i + CONCURRENCY < queue.length) {
      await delay(batchDelay);
    }
  }

  const summariesDone = status.done;
  status.cached = Object.keys(summaries).length;
  console.log(`AI scan complete: ${summariesDone} processed, ${status.cached} total cached`);

  // Phase 2: auto-rename (skip if stopped)
  let titlesDone = 0;
  if (status.running) {
    titlesDone = await autoRenamePhase(data);
  }

  status.running = false;
  status.phase = 'idle';
  status.result = { summaries: summariesDone, titles: titlesDone, skipped: status.cached - summariesDone };
}

/**
 * Auto-rename sessions without customTitle. Returns count of titles generated.
 */
async function autoRenamePhase(data: ReturnType<typeof scanner.getData>): Promise<number> {
  const renameQueue: string[] = [];

  for (const project of data.projects) {
    for (const session of project.sessions) {
      if (session.isEmpty) continue;
      if (session.messageCount <= 1) continue;
      if (session.customTitle) continue;
      renameQueue.push(session.sessionId);
    }
  }

  if (renameQueue.length === 0) {
    console.log('Auto-rename: all sessions already have titles');
    return 0;
  }

  status.running = true;
  status.phase = 'rename';
  status.total = renameQueue.length;
  status.done = 0;
  console.log(`Auto-rename started: ${renameQueue.length} sessions`);

  const CONCURRENCY = 3;
  for (let i = 0; i < renameQueue.length; i += CONCURRENCY) {
    if (!status.running) break;
    await waitWhilePaused();

    const batch = renameQueue.slice(i, i + CONCURRENCY);
    try {
      await Promise.all(batch.map(async (sessionId) => {
        const title = await generateTitleWithRetry(sessionId);
        if (title) {
          scanner.setTitle(sessionId, title);
        }
        status.done++;
      }));
    } catch (err: any) {
      console.error(`Auto-rename error: ${err.message}`);
      status.error = err.message || 'AI request failed';
      status.running = false;
      status.phase = 'idle';
      break;
    }

    if (i + CONCURRENCY < renameQueue.length) {
      await delay(batchDelay);
    }
  }

  console.log(`Auto-rename complete: ${status.done} processed`);
  return status.done;
}

export function stop(): void {
  status.running = false;
  status.cancelled = true;
  paused = false;
}

export function clearError(): void {
  status.error = null;
}
