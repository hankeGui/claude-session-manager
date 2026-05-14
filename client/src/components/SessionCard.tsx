import { useState, ReactNode } from 'react';
import { Session } from '../api';
import { useStore } from '../store';
import { confirm } from './ConfirmDialog';
import { showToast } from './Toast';
import ResumeDialog from './ResumeDialog';
import RenameDialog from './RenameDialog';

interface Props {
  session: Session;
  onView: (session: Session) => void;
}

/** Highlight matching portions of text */
function highlightText(text: string, query: string): ReactNode {
  if (!query || !text) return text;
  const idx = text.toLowerCase().indexOf(query.toLowerCase());
  if (idx === -1) return text;
  return (
    <>
      {text.slice(0, idx)}
      <mark className="bg-accent/30 text-inherit rounded-sm px-0.5">{text.slice(idx, idx + query.length)}</mark>
      {text.slice(idx + query.length)}
    </>
  );
}

function formatDate(iso: string): string {
  if (!iso) return '';
  const d = new Date(iso);
  return d.toLocaleDateString('zh-CN', { month: '2-digit', day: '2-digit' }) +
    ' ' + d.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return bytes + 'B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + 'KB';
  return (bytes / (1024 * 1024)).toFixed(1) + 'MB';
}

export default function SessionCard({ session, onView }: Props) {
  const selected = useStore((s) => s.selected);
  const toggleSelect = useStore((s) => s.toggleSelect);
  const deleteSession = useStore((s) => s.deleteSession);
  const setTitle = useStore((s) => s.setTitle);
  const setFavorite = useStore((s) => s.setFavorite);
  const [showResume, setShowResume] = useState(false);
  const [showRename, setShowRename] = useState(false);

  const searchQuery = useStore((s) => s.searchQuery);
  const isSelected = selected.has(session.sessionId);
  const title = session.customTitle || session.summary || session.firstPrompt || session.sessionId.slice(0, 8);
  const searchScore = session._searchScore as number | undefined;
  const matchedFields = session._matchedFields as string[] | undefined;

  const handleDelete = async (e: React.MouseEvent) => {
    e.stopPropagation();
    const { confirmed } = await confirm({
      title: 'Delete Session',
      message: `Delete this session?\n\n"${title}"`,
      okText: 'Delete',
    });
    if (confirmed) {
      try {
        await deleteSession(session.sessionId);
        showToast('Session deleted', 'success');
      } catch (err: any) {
        showToast(err.message, 'error');
      }
    }
  };

  const handleRename = (e: React.MouseEvent) => {
    e.stopPropagation();
    setShowRename(true);
  };

  const handleRenameSave = async (newTitle: string) => {
    setShowRename(false);
    try {
      await setTitle(session.sessionId, newTitle);
      showToast(newTitle ? 'Title updated' : 'Title removed', 'success');
    } catch (err: any) {
      showToast(err.message, 'error');
    }
  };

  const handleResume = (e: React.MouseEvent) => {
    e.stopPropagation();
    setShowResume(true);
  };

  return (
    <div
      className={`flex items-start gap-3 px-4 py-3.5 mb-2 bg-bg-secondary border rounded-md cursor-pointer transition-colors hover:border-accent ${
        session.isEmpty ? 'border-l-[3px] border-l-warning border-t-border border-r-border border-b-border' : 'border-border'
      }`}
      onClick={() => onView(session)}
    >
      <input
        type="checkbox"
        checked={isSelected}
        onChange={() => toggleSelect(session.sessionId)}
        onClick={(e) => e.stopPropagation()}
        className="mt-1 cursor-pointer"
      />
      <button
        onClick={(e) => { e.stopPropagation(); setFavorite(session.sessionId, !session.isFavorite); }}
        className={`mt-0.5 text-base leading-none transition-colors ${session.isFavorite ? 'text-yellow-400' : 'text-text-muted/30 hover:text-yellow-400/60'}`}
        title={session.isFavorite ? 'Remove from favorites' : 'Add to favorites'}
      >
        {session.isFavorite ? '\u2605' : '\u2606'}
      </button>
      <div className="flex-1 min-w-0">
        <div className={`text-sm font-medium truncate mb-1 flex items-center gap-2 ${session.customTitle ? 'text-accent font-semibold' : ''}`} title={title}>
          <span className="truncate">
            {searchQuery && matchedFields?.includes('title') ? highlightText(title, searchQuery) : title}
          </span>
          {searchScore && (
            <span className="shrink-0 text-[9px] px-1.5 py-0.5 rounded bg-accent/15 text-accent font-normal">
              {searchScore}
              {matchedFields && matchedFields.length > 0 && (
                <span className="ml-1 text-text-muted">{matchedFields.join(',')}</span>
              )}
            </span>
          )}
        </div>
        {session.firstPrompt && session.firstPrompt !== title && (
          <div className="text-xs text-text-muted truncate mb-1.5" title={session.firstPrompt}>
            {searchQuery && matchedFields?.includes('firstPrompt') ? highlightText(session.firstPrompt, searchQuery) : session.firstPrompt}
          </div>
        )}
        <div className="flex gap-3 text-[11px] text-text-muted flex-wrap">
          <span>{session.messageCount} msgs</span>
          <span>{formatSize(session.diskSize)}</span>
          <span>{formatDate(session.modified)}</span>
          {session.gitBranch && (
            <span className={`bg-bg-card px-1.5 py-0.5 rounded text-[10px] ${searchQuery && matchedFields?.includes('branch') ? 'text-white bg-accent/30' : 'text-accent'}`}>
              {searchQuery && matchedFields?.includes('branch') ? highlightText(session.gitBranch, searchQuery) : session.gitBranch}
            </span>
          )}
          {session.isEmpty && (
            <span className="bg-warning text-black px-1.5 py-0.5 rounded text-[10px] font-semibold">
              Empty{session.emptyReason ? ` · ${session.emptyReason}` : ''}
            </span>
          )}
        </div>
        {session.tags && session.tags.length > 0 && (
          <div className="flex flex-wrap gap-1 mt-1.5">
            {session.tags.map((tag) => (
              <span key={tag} className={`px-1.5 py-0.5 text-[10px] rounded ${searchQuery && matchedFields?.includes('tag') && tag.toLowerCase().includes(searchQuery.toLowerCase()) ? 'bg-accent/30 text-white' : 'bg-accent/10 text-accent'}`}>
                {searchQuery && matchedFields?.includes('tag') ? highlightText(tag, searchQuery) : tag}
              </span>
            ))}
          </div>
        )}
      </div>
      <div className="flex gap-1.5 shrink-0" onClick={(e) => e.stopPropagation()}>
        <button
          onClick={(e) => { e.stopPropagation(); onView(session); }}
          className="px-2 py-1 text-[11px] border border-border text-text-primary rounded hover:bg-border"
        >
          View
        </button>
        <button
          onClick={handleRename}
          className="px-2 py-1 text-[11px] border border-accent text-accent rounded hover:bg-accent hover:text-black"
        >
          Rename
        </button>
        <button
          onClick={handleResume}
          className="px-2 py-1 text-[11px] border border-success text-success rounded hover:bg-success hover:text-black"
        >
          Resume
        </button>
        <button
          onClick={handleDelete}
          className="px-2 py-1 text-[11px] border border-danger text-danger rounded hover:bg-danger hover:text-white"
        >
          Del
        </button>
      </div>
      {showResume && (
        <ResumeDialog session={session} onClose={() => setShowResume(false)} />
      )}
      {showRename && (
        <RenameDialog
          sessionId={session.sessionId}
          currentTitle={session.customTitle || session.summary || session.firstPrompt || ''}
          onClose={() => setShowRename(false)}
          onSave={handleRenameSave}
        />
      )}
    </div>
  );
}
