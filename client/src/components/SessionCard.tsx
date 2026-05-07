import { useEffect } from 'react';
import { api, Session } from '../api';
import { useStore } from '../store';
import { confirm } from './ConfirmDialog';
import { showToast } from './Toast';

interface Props {
  session: Session;
  onView: (session: Session) => void;
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

  const isSelected = selected.has(session.sessionId);
  const title = session.customTitle || session.summary || session.firstPrompt || session.sessionId.slice(0, 8);

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

  const handleRename = async (e: React.MouseEvent) => {
    e.stopPropagation();
    const { confirmed } = await confirm({
      title: 'Rename Session',
      message: `<div>
        <div style="display:flex;gap:8px;align-items:center">
          <input id="rename-input" type="text" value="${(session.customTitle || '').replace(/"/g, '&quot;')}"
            placeholder="Enter new title..."
            style="flex:1;padding:8px 12px;border:1px solid #2a3a5e;border-radius:6px;background:#1a1a2e;color:#e0e0e0;font-size:14px;" />
          <button id="ai-gen-btn" type="button"
            style="padding:6px 12px;border:1px solid #ffa726;border-radius:6px;background:transparent;color:#ffa726;font-size:12px;cursor:pointer;white-space:nowrap">
            AI Generate
          </button>
        </div>
      </div>`,
      html: true,
      okText: 'Save',
      okClass: 'success',
    });
    if (!confirmed) return;
    const input = document.getElementById('rename-input') as HTMLInputElement;
    const newTitle = input?.value ?? '';
    try {
      await setTitle(session.sessionId, newTitle);
      showToast(newTitle ? 'Title updated' : 'Title removed', 'success');
    } catch (err: any) {
      showToast(err.message, 'error');
    }
  };

  // Attach AI generate button handler after dialog renders
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      const btn = (e.target as HTMLElement).closest('#ai-gen-btn');
      if (!btn) return;
      e.preventDefault();
      e.stopPropagation();
      btn.textContent = 'Generating...';
      (btn as HTMLButtonElement).disabled = true;
      api.autoRename(session.sessionId).then(({ title: newTitle }) => {
        const input = document.getElementById('rename-input') as HTMLInputElement;
        if (input) input.value = newTitle;
        btn.textContent = 'AI Generate';
        (btn as HTMLButtonElement).disabled = false;
      }).catch(() => {
        btn.textContent = 'Failed';
        setTimeout(() => {
          btn.textContent = 'AI Generate';
          (btn as HTMLButtonElement).disabled = false;
        }, 2000);
      });
    };
    document.addEventListener('click', handler);
    return () => document.removeEventListener('click', handler);
  }, [session.sessionId]);

  const handleResume = async (e: React.MouseEvent) => {
    e.stopPropagation();
    const projects = useStore.getState().projects;
    const project = projects.find((p) => p.dirName === session.dirName);
    const cwd = project?.projectPath || session.projectPath || '~';
    const flags = '';
    const cmdPreview = `cd ${cwd} && claude${flags} --resume ${session.sessionId}`;
    const { confirmed, checked } = await confirm({
      title: 'Resume Session',
      message: `<div style="color:#4fc3f7;font-size:13px;margin-bottom:10px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${title}</div>
        <div style="background:#1a1a2e;border:1px solid #2a3a5e;border-radius:4px;padding:8px 12px;font-size:12px;overflow-x:auto;white-space:nowrap">
          <code style="color:#66bb6a;font-family:monospace">${cmdPreview}</code>
        </div>`,
      html: true,
      okText: 'Resume',
      okClass: 'success',
      checkbox: { label: 'Add --dangerously-skip-permissions' },
    });
    if (!confirmed) return;
    try {
      await api.resume(session.sessionId, checked);
      showToast('Session resumed in terminal', 'success');
    } catch (err: any) {
      showToast(err.message, 'error');
    }
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
      <div className="flex-1 min-w-0">
        <div className={`text-sm font-medium truncate mb-1 ${session.customTitle ? 'text-accent font-semibold' : ''}`}>
          {title}
        </div>
        {session.firstPrompt && session.firstPrompt !== title && (
          <div className="text-xs text-text-muted truncate mb-1.5">{session.firstPrompt}</div>
        )}
        <div className="flex gap-3 text-[11px] text-text-muted flex-wrap">
          <span>{session.messageCount} msgs</span>
          <span>{formatSize(session.diskSize)}</span>
          <span>{formatDate(session.modified)}</span>
          {session.gitBranch && (
            <span className="bg-bg-card text-accent px-1.5 py-0.5 rounded text-[10px]">
              {session.gitBranch}
            </span>
          )}
          {session.isEmpty && (
            <span className="bg-warning text-black px-1.5 py-0.5 rounded text-[10px] font-semibold uppercase">
              Empty
            </span>
          )}
        </div>
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
    </div>
  );
}
