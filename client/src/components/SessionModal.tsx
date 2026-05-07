import { useEffect, useState } from 'react';
import { api, Message, Session } from '../api';
import MessageView from './MessageView';

interface Props {
  session: Session;
  onClose: () => void;
}

function formatDate(iso: string): string {
  if (!iso) return '';
  return new Date(iso).toLocaleString('zh-CN');
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return bytes + 'B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + 'KB';
  return (bytes / (1024 * 1024)).toFixed(1) + 'MB';
}

export default function SessionModal({ session, onClose }: Props) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<'all' | 'user'>('all');
  const [projectInfo, setProjectInfo] = useState<{ displayName: string } | null>(null);

  useEffect(() => {
    setLoading(true);
    api.getMessages(session.sessionId).then((data) => {
      setMessages(data.messages);
      setProjectInfo(data.project);
      setLoading(false);
    }).catch(() => setLoading(false));
  }, [session.sessionId]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [onClose]);

  const filtered = filter === 'user'
    ? messages.filter((m) => m.type === 'user')
    : messages;

  const title = session.customTitle || session.summary || session.firstPrompt || session.sessionId.slice(0, 8);

  return (
    <div
      className="fixed inset-0 bg-black/70 flex items-center justify-center z-[100]"
      onClick={onClose}
    >
      <div
        className="bg-bg-secondary border border-border rounded-lg w-[90%] max-w-[800px] max-h-[85vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex justify-between items-center px-5 py-4 border-b border-border">
          <h3 className="text-base font-medium truncate mr-4">{title}</h3>
          <button
            onClick={onClose}
            className="text-xl text-text-muted hover:text-text-primary border-none bg-transparent cursor-pointer"
          >
            &times;
          </button>
        </div>

        {/* Meta */}
        <div className="px-5 py-3 text-xs text-text-muted border-b border-border flex flex-wrap gap-4">
          {projectInfo && <span>Project: {projectInfo.displayName}</span>}
          {session.gitBranch && <span>Branch: {session.gitBranch}</span>}
          <span>{session.messageCount} messages</span>
          <span>{formatSize(session.diskSize)}</span>
          <span>Created: {formatDate(session.created)}</span>
          <span>Modified: {formatDate(session.modified)}</span>
        </div>

        {/* Toolbar */}
        <div className="flex items-center gap-2 px-5 py-2 border-b border-border">
          <button
            onClick={() => setFilter('all')}
            className={`px-3 py-1 text-xs rounded-md border ${
              filter === 'all'
                ? 'bg-accent text-black border-accent'
                : 'border-border text-text-primary hover:bg-border'
            }`}
          >
            All
          </button>
          <button
            onClick={() => setFilter('user')}
            className={`px-3 py-1 text-xs rounded-md border ${
              filter === 'user'
                ? 'bg-accent text-black border-accent'
                : 'border-border text-text-primary hover:bg-border'
            }`}
          >
            User Only
          </button>
          <span className="ml-auto text-xs text-text-muted">
            {filtered.length} messages
          </span>
        </div>

        {/* Messages */}
        <div className="flex-1 overflow-y-auto px-5 py-4">
          {loading ? (
            <div className="text-center text-text-muted py-8">Loading messages...</div>
          ) : filtered.length === 0 ? (
            <div className="text-center text-text-muted py-8">No messages</div>
          ) : (
            filtered.map((msg, i) => <MessageView key={i} message={msg} />)
          )}
        </div>
      </div>
    </div>
  );
}
