import fs from 'fs';
import path from 'path';
import * as scanner from './scanner';
import { readSessionMessages } from './session-reader';
import { askAi, getClient } from './ai-client';

const SUMMARIES_FILE = path.join(__dirname, '..', '..', 'session-ai-summaries.json');

interface AiSummaryEntry {
  summary: string;
  generatedAt: string;
}

let summaries: Record<string, AiSummaryEntry> = {};
let status = { running: false, total: 0, done: 0, cached: 0 };
let paused = false;

function loadSummaries(): void {
  try {
    summaries = JSON.parse(fs.readFileSync(SUMMARIES_FILE, 'utf-8'));
  } catch {
    summaries = {};
  }
}

function saveSummaries(): void {
  fs.writeFileSync(SUMMARIES_FILE, JSON.stringify(summaries, null, 2));
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
  return { ...status };
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitWhilePaused(): Promise<void> {
  while (paused) await delay(200);
}

/**
 * Pause scanning (e.g. when user triggers batch rename)
 */
export function pause(): void { paused = true; }

/**
 * Resume scanning after pause
 */
export function resume(): void { paused = false; }

async function processOne(item: { sessionId: string; dirName: string }): Promise<void> {
  try {
    const msgs = await readSessionMessages(item.dirName, item.sessionId, { limit: 5, offset: 0 });
    if (msgs.messages.length === 0) {
      status.done++;
      return;
    }

    const context = msgs.messages.map((m) => {
      const role = m.type === 'user' ? 'User' : 'Assistant';
      return `${role}: ${m.content.slice(0, 200)}`;
    }).join('\n');

    const prompt = `Summarize this conversation in one short sentence (under 60 chars, same language as conversation):\n---\n${context}\n---\nOutput ONLY the summary, nothing else.`;

    const result = await askAi(prompt, { maxTokens: 100 });
    const summary = result.trim().replace(/^["']|["']$/g, '');

    if (summary) {
      summaries[item.sessionId] = { summary, generatedAt: new Date().toISOString() };
    }
  } catch (err: any) {
    console.error(`AI scan error [${item.sessionId.slice(0, 8)}]: ${err.message}`);
  }
  status.done++;
}

/**
 * Background AI scan: generate summaries for sessions not yet cached.
 * Fire-and-forget — does not block server startup.
 */
export async function start(): Promise<void> {
  loadSummaries();

  if (!getClient()) {
    console.log('AI scan skipped: AI not configured');
    return;
  }

  const data = scanner.getData();
  const queue: { sessionId: string; dirName: string }[] = [];

  for (const project of data.projects) {
    for (const session of project.sessions) {
      if (summaries[session.sessionId]) continue; // already cached
      if (session.isEmpty) continue;
      if (session.messageCount <= 1) continue;
      queue.push({ sessionId: session.sessionId, dirName: session.dirName });
    }
  }

  status.cached = Object.keys(summaries).length;
  status.total = queue.length;
  status.done = 0;

  if (queue.length === 0) {
    console.log(`AI scan: all ${status.cached} sessions already cached`);
    return;
  }

  status.running = true;
  console.log(`AI scan started: ${queue.length} sessions to process (${status.cached} cached)`);

  // Process in batches of 3 concurrently, 100ms between batches
  const CONCURRENCY = 3;
  for (let i = 0; i < queue.length; i += CONCURRENCY) {
    if (!status.running) break;
    await waitWhilePaused();

    const batch = queue.slice(i, i + CONCURRENCY);
    await Promise.all(batch.map((item) => processOne(item)));
    saveSummaries();

    if (i + CONCURRENCY < queue.length) {
      await delay(100);
    }
  }

  status.running = false;
  status.cached = Object.keys(summaries).length;
  console.log(`AI scan complete: ${status.done} processed, ${status.cached} total cached`);
}

/**
 * Stop background scan (e.g. on server shutdown)
 */
export function stop(): void {
  status.running = false;
}
