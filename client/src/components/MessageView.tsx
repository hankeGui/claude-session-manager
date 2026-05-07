import { useState } from 'react';
import { Message } from '../api';
import { cleanMessageContent } from '../utils/cleanContent';

interface Props {
  message: Message;
}

export default function MessageView({ message }: Props) {
  const [expanded, setExpanded] = useState(false);

  const content = typeof message.content === 'string'
    ? cleanMessageContent(message.content)
    : '';

  // Skip completely empty messages
  if (!content && message.type === 'user') return null;

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
      <div
        className={`text-sm leading-relaxed whitespace-pre-wrap break-words ${
          message.type === 'user' ? 'text-white' : 'text-text-primary'
        } ${isLong && !expanded ? 'max-h-[120px] overflow-hidden relative' : ''}`}
      >
        {content || <span className="text-text-muted italic">No content</span>}
        {isLong && !expanded && (
          <div className="absolute bottom-0 left-0 right-0 h-10 bg-gradient-to-t from-bg-primary to-transparent" />
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
      {message.toolCalls && message.toolCalls.length > 0 && (
        <div className="mt-1.5 text-[10px] text-text-muted italic">
          Tools: {message.toolCalls.join(', ')}
        </div>
      )}
    </div>
  );
}
