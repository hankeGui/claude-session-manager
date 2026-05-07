import fs from 'fs';
import readline from 'readline';
import { sessionJsonlPath } from '../utils/paths';
import type { SessionMessage } from '../types';

interface ReadResult {
  messages: SessionMessage[];
  total: number;
}

export async function readSessionMessages(
  dirName: string,
  sessionId: string,
  { limit = 100, offset = 0 } = {}
): Promise<ReadResult> {
  const filePath = sessionJsonlPath(dirName, sessionId);

  if (!fs.existsSync(filePath)) {
    return { messages: [], total: 0 };
  }

  const messages: SessionMessage[] = [];
  const stream = fs.createReadStream(filePath, { encoding: 'utf-8' });
  const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });

  let lineNum = 0;
  for await (const line of rl) {
    if (!line.trim()) continue;
    let obj: any;
    try {
      obj = JSON.parse(line);
    } catch {
      continue;
    }

    if (obj.type !== 'user' && obj.type !== 'assistant') continue;

    lineNum++;
    if (lineNum <= offset) continue;
    if (messages.length >= limit) continue;

    const msg: SessionMessage = {
      type: obj.type,
      content: '',
      timestamp: obj.timestamp || '',
    };

    if (obj.message?.content) {
      if (typeof obj.message.content === 'string') {
        msg.content = obj.message.content;
      } else if (Array.isArray(obj.message.content)) {
        const parts: string[] = [];
        const toolCalls: string[] = [];
        for (const block of obj.message.content) {
          if (block.type === 'text') {
            parts.push(block.text);
          } else if (block.type === 'tool_use') {
            toolCalls.push(block.name);
          }
        }
        msg.content = parts.join('\n');
        if (toolCalls.length) msg.toolCalls = toolCalls;
      }
    }

    if (obj.type === 'assistant' && msg.content && msg.content.length > 3000) {
      msg.content = msg.content.slice(0, 3000) + '\n... (truncated)';
    }

    if (messages.length < limit) {
      messages.push(msg);
    }
  }

  return { messages, total: lineNum };
}
