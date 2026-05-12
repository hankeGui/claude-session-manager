import fs from 'fs';
import readline from 'readline';
import { sessionJsonlPath } from '../utils/paths';
import type { SessionMessage, ToolCall } from '../types';

interface ReadResult {
  messages: SessionMessage[];
  total: number;
}

interface RawEntry {
  type: string;
  timestamp?: string;
  message?: { content: string | any[] };
}

function extractFromEntry(obj: RawEntry): { text: string; tools: ToolCall[]; isToolResult: boolean } {
  const textParts: string[] = [];
  const tools: ToolCall[] = [];
  let isToolResult = false;
  const content = obj.message?.content;
  if (!content) return { text: '', tools: [], isToolResult: false };

  if (typeof content === 'string') {
    textParts.push(content);
  } else if (Array.isArray(content)) {
    let hasOnlyToolResults = content.length > 0;
    for (const block of content) {
      if (block.type === 'text' && block.text) {
        textParts.push(block.text);
        hasOnlyToolResults = false;
      } else if (block.type === 'tool_use' && block.name) {
        const tool: ToolCall = { name: block.name };
        // Extract useful details for display
        if (block.input) {
          const inp = block.input;
          if (block.name === 'Bash' && inp.command) {
            tool.input = { command: inp.command.slice(0, 200) };
          } else if (block.name === 'Read' && inp.file_path) {
            tool.input = { file_path: inp.file_path };
          } else if (block.name === 'Edit' && inp.file_path) {
            tool.input = { file_path: inp.file_path };
          } else if (block.name === 'Write' && inp.file_path) {
            tool.input = { file_path: inp.file_path };
          } else if (block.name === 'Grep' && inp.pattern) {
            tool.input = { pattern: inp.pattern };
          } else if (block.name === 'Glob' && inp.pattern) {
            tool.input = { pattern: inp.pattern };
          }
        }
        tools.push(tool);
        hasOnlyToolResults = false;
      } else if (block.type === 'tool_result') {
        // tool_result blocks are system responses, skip their content
      } else {
        // thinking, etc. — ignore
        hasOnlyToolResults = false;
      }
    }
    if (hasOnlyToolResults && content.length > 0) {
      isToolResult = true;
    }
  }
  return { text: textParts.join('\n'), tools, isToolResult };
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

  // First pass: parse all entries and merge consecutive assistant messages into turns
  const turns: SessionMessage[] = [];
  const stream = fs.createReadStream(filePath, { encoding: 'utf-8' });
  const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });

  let pendingAssistant: SessionMessage | null = null;

  function flushAssistant() {
    if (!pendingAssistant) return;
    // Truncate long content
    if (pendingAssistant.content && pendingAssistant.content.length > 3000) {
      pendingAssistant.content = pendingAssistant.content.slice(0, 3000) + '\n... (truncated)';
    }
    // Skip assistant turns with no text and no tools
    if (pendingAssistant.content || (pendingAssistant.toolCalls && pendingAssistant.toolCalls.length > 0)) {
      turns.push(pendingAssistant);
    }
    pendingAssistant = null;
  }

  for await (const line of rl) {
    if (!line.trim()) continue;
    let obj: RawEntry;
    try {
      obj = JSON.parse(line);
    } catch {
      continue;
    }

    if (obj.type === 'user') {
      const { text, isToolResult } = extractFromEntry(obj);
      if (isToolResult) {
        // tool_result messages are system plumbing, don't break assistant turn
        continue;
      }
      flushAssistant();
      if (text) {
        turns.push({ type: 'user', content: text, timestamp: obj.timestamp || '' });
      }
    } else if (obj.type === 'assistant') {
      const { text, tools } = extractFromEntry(obj);
      if (pendingAssistant) {
        // Merge into current assistant turn
        if (text) {
          pendingAssistant.content = pendingAssistant.content
            ? pendingAssistant.content + '\n' + text
            : text;
        }
        if (tools.length) {
          pendingAssistant.toolCalls = [...(pendingAssistant.toolCalls || []), ...tools];
        }
      } else {
        // Start new assistant turn
        pendingAssistant = {
          type: 'assistant',
          content: text,
          timestamp: obj.timestamp || '',
          toolCalls: tools.length ? [...tools] : undefined,
        };
      }
    }
    // Skip other types (system, attachment, file-history-snapshot, etc.)
  }
  flushAssistant();

  // Apply pagination
  const total = turns.length;
  const paginated = turns.slice(offset, offset + limit);

  return { messages: paginated, total };
}
