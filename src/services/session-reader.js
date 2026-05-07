const fs = require('fs');
const readline = require('readline');
const { sessionJsonlPath } = require('../utils/paths');

async function readSessionMessages(dirName, sessionId, { limit = 100, offset = 0 } = {}) {
  const filePath = sessionJsonlPath(dirName, sessionId);

  if (!fs.existsSync(filePath)) {
    return { messages: [], total: 0 };
  }

  const messages = [];
  const stream = fs.createReadStream(filePath, { encoding: 'utf-8' });
  const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });

  let lineNum = 0;
  for await (const line of rl) {
    if (!line.trim()) continue;
    let obj;
    try {
      obj = JSON.parse(line);
    } catch {
      continue;
    }

    // Only include user and assistant messages
    if (obj.type !== 'user' && obj.type !== 'assistant') continue;

    lineNum++;
    if (lineNum <= offset) continue;
    if (messages.length >= limit) continue; // still count total

    const msg = {
      type: obj.type,
      timestamp: obj.timestamp || null,
      uuid: obj.uuid || null,
    };

    if (obj.message && obj.message.content) {
      if (typeof obj.message.content === 'string') {
        msg.content = obj.message.content;
      } else if (Array.isArray(obj.message.content)) {
        const parts = [];
        const toolCalls = [];
        for (const block of obj.message.content) {
          if (block.type === 'text') {
            parts.push(block.text);
          } else if (block.type === 'tool_use') {
            toolCalls.push({ name: block.name, id: block.id });
          }
        }
        msg.content = parts.join('\n');
        if (toolCalls.length) msg.toolCalls = toolCalls;
      }
    }

    // Keep full user content, cap assistant content for response size
    if (obj.type === 'assistant' && msg.content && msg.content.length > 3000) {
      msg.content = msg.content.slice(0, 3000) + '\n... (truncated)';
    }

    if (messages.length < limit) {
      messages.push(msg);
    }
  }

  return { messages, total: lineNum };
}

module.exports = { readSessionMessages };
