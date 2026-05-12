import { useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Message, ToolCall } from '../api';
import { cleanMessageContent } from '../utils/cleanContent';

interface Props {
  message: Message;
}

function ToolCallView({ tool }: { tool: ToolCall }) {
  const inp = tool.input;
  let detail = '';
  if (inp) {
    if (tool.name === 'Bash' && inp.command) {
      detail = inp.command;
    } else if (inp.file_path) {
      detail = inp.file_path;
    } else if (inp.pattern) {
      detail = inp.pattern;
    }
  }

  return (
    <div className="flex items-start gap-2 py-1 px-2 rounded bg-bg-card/50 text-[11px] font-mono">
      <span className="text-accent font-semibold whitespace-nowrap">{tool.name}</span>
      {detail && (
        <span className="text-text-muted truncate" title={detail}>
          {detail}
        </span>
      )}
    </div>
  );
}

export default function MessageView({ message }: Props) {
  const [expanded, setExpanded] = useState(false);

  const content = typeof message.content === 'string'
    ? cleanMessageContent(message.content)
    : '';

  // Skip completely empty user messages
  if (!content && message.type === 'user') return null;

  const hasTools = message.toolCalls && message.toolCalls.length > 0;
  const isToolOnly = !content && hasTools;
  const isLong = content.length > 500 && message.type === 'assistant';

  return (
    <div
      className={`mb-3 rounded-md ${
        message.type === 'user'
          ? 'bg-bg-card border-l-4 border-l-accent px-4 py-3.5'
          : 'bg-bg-primary border-l-[3px] border-l-border px-4 py-2.5'
      }`}
    >
      <div className="text-[10px] font-semibold uppercase mb-1.5 text-text-muted">
        {message.type}
      </div>

      {isToolOnly ? (
        <ToolSection tools={message.toolCalls!} defaultExpanded={true} />
      ) : (
        <>
          <div
            className={`prose prose-invert prose-sm max-w-none
              prose-p:my-1 prose-pre:my-2 prose-pre:bg-bg-card prose-pre:border prose-pre:border-border
              prose-code:text-accent prose-code:bg-bg-card prose-code:px-1 prose-code:rounded prose-code:text-xs
              prose-headings:text-text-primary prose-a:text-accent
              ${message.type === 'user' ? 'prose-p:text-white' : 'prose-p:text-text-primary'}
              ${isLong && !expanded ? 'max-h-[150px] overflow-hidden relative' : ''}`}
          >
            <ReactMarkdown remarkPlugins={[remarkGfm]}>{content}</ReactMarkdown>
            {isLong && !expanded && (
              <div className="absolute bottom-0 left-0 right-0 h-12 bg-gradient-to-t from-bg-primary to-transparent" />
            )}
          </div>
          {isLong && (
            <button
              onClick={() => setExpanded(!expanded)}
              className="mt-1 px-2 py-0.5 text-[10px] border border-border rounded text-text-muted hover:text-text-primary hover:border-text-muted"
            >
              {expanded ? 'Show less' : 'Show more'}
            </button>
          )}
          {hasTools && (
            <ToolSection tools={message.toolCalls!} defaultExpanded={false} />
          )}
        </>
      )}
    </div>
  );
}

function ToolSection({ tools, defaultExpanded }: { tools: ToolCall[]; defaultExpanded: boolean }) {
  const [expanded, setExpanded] = useState(defaultExpanded);
  const count = tools.length;

  // Dedupe for summary
  const nameCounts: Record<string, number> = {};
  for (const t of tools) nameCounts[t.name] = (nameCounts[t.name] || 0) + 1;
  const summary = Object.entries(nameCounts)
    .map(([name, c]) => c > 1 ? `${name} ×${c}` : name)
    .join(', ');

  return (
    <div className="mt-2">
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex items-center gap-1.5 text-[11px] text-text-muted hover:text-text-primary"
      >
        <span className="opacity-70">⚙</span>
        <span>{count} tool{count > 1 ? 's' : ''}: {summary}</span>
        <span className="text-[9px]">{expanded ? '▼' : '▶'}</span>
      </button>
      {expanded && (
        <div className="mt-1.5 flex flex-col gap-1 max-h-[200px] overflow-y-auto">
          {tools.map((tool, i) => (
            <ToolCallView key={i} tool={tool} />
          ))}
        </div>
      )}
    </div>
  );
}
