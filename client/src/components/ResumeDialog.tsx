import { useState, useEffect } from 'react';
import { api, Session } from '../api';
import { useStore } from '../store';
import { showToast } from './Toast';

interface Props {
  session: Session;
  onClose: () => void;
}

export default function ResumeDialog({ session, onClose }: Props) {
  const projects = useStore((s) => s.projects);
  const project = projects.find((p) => p.dirName === session.dirName);
  const cwd = project?.projectPath || session.projectPath || '~';
  const baseCmd = `cd ${cwd} && claude --resume ${session.sessionId}`;
  const skipCmd = `cd ${cwd} && claude --resume ${session.sessionId} --dangerously-skip-permissions`;

  const [terminal, setTerminal] = useState('auto');
  const [copied, setCopied] = useState<string | null>(null);
  const [cmd1, setCmd1] = useState(baseCmd);
  const [cmd2, setCmd2] = useState(skipCmd);

  const title = session.customTitle || session.summary || session.firstPrompt || session.sessionId.slice(0, 8);

  useEffect(() => {
    api.getPreferences().then((prefs) => {
      if (prefs.terminal) setTerminal(prefs.terminal);
    }).catch(() => {});

    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [onClose]);

  const handleCopy = (cmd: string, id: string) => {
    navigator.clipboard.writeText(cmd);
    setCopied(id);
    setTimeout(() => setCopied(null), 1500);
  };

  const handleResume = async (skipPermissions: boolean) => {
    try { await api.setPreferences({ terminal }); } catch {}
    try {
      await api.resume(session.sessionId, skipPermissions, terminal);
      showToast('Session resumed in terminal', 'success');
      onClose();
    } catch (err: any) {
      showToast(err.message, 'error');
    }
  };

  return (
    <div
      className="fixed inset-0 bg-black/70 flex items-center justify-center z-[200]"
      onClick={onClose}
    >
      <div
        className="bg-bg-secondary border border-border rounded-lg p-6 w-[720px] max-w-[95vw]"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between mb-3">
          <h3 className="font-semibold text-base">Resume Session</h3>
          <button
            onClick={onClose}
            className="text-text-muted hover:text-text-primary text-xl leading-none px-1"
          >
            &times;
          </button>
        </div>

        {/* Session title */}
        <div className="text-accent text-sm mb-4 truncate">{title}</div>

        {/* Terminal selector */}
        <div className="flex items-center gap-3 mb-5">
          <label className="text-xs text-text-muted shrink-0">Terminal:</label>
          <select
            value={terminal}
            onChange={(e) => setTerminal(e.target.value)}
            className="px-3 py-1.5 border border-border rounded-md bg-bg-primary text-text-primary text-xs cursor-pointer"
          >
            <option value="auto">Auto (System Default)</option>
            <option value="iTerm">iTerm2</option>
            <option value="Terminal">Terminal.app</option>
          </select>
        </div>

        {/* Normal resume */}
        <div className="mb-4">
          <div className="text-xs text-text-muted mb-1.5">Resume command:</div>
          <div className="flex items-center gap-2">
            <input
              ref={input1Ref}
              type="text"
              value={cmd1}
              onChange={(e) => setCmd1(e.target.value)}
              className="flex-1 px-3 py-2 bg-bg-primary border border-border rounded-md text-success text-xs font-mono focus:outline-none focus:border-accent"
            />
            <button
              onClick={() => handleCopy(cmd1, 'base')}
              className="shrink-0 px-3 py-2 text-[11px] border border-border rounded-md hover:bg-border text-text-muted"
            >
              {copied === 'base' ? 'Copied!' : 'Copy'}
            </button>
            <button
              onClick={() => handleResume(false)}
              className="shrink-0 px-3 py-2 text-[11px] border border-success text-success rounded-md hover:bg-success hover:text-black font-medium"
            >
              Resume
            </button>
          </div>
        </div>

        {/* Skip permissions resume */}
        <div>
          <div className="text-xs text-warning mb-1.5">Skip permissions (dangerously auto-approve all tool calls):</div>
          <div className="flex items-center gap-2">
            <input
              ref={input2Ref}
              type="text"
              value={cmd2}
              onChange={(e) => setCmd2(e.target.value)}
              className="flex-1 px-3 py-2 bg-bg-primary border border-border rounded-md text-warning text-xs font-mono focus:outline-none focus:border-accent"
            />
            <button
              onClick={() => handleCopy(cmd2, 'skip')}
              className="shrink-0 px-3 py-2 text-[11px] border border-border rounded-md hover:bg-border text-text-muted"
            >
              {copied === 'skip' ? 'Copied!' : 'Copy'}
            </button>
            <button
              onClick={() => handleResume(true)}
              className="shrink-0 px-3 py-2 text-[11px] border border-warning text-warning rounded-md hover:bg-warning hover:text-black font-medium"
            >
              Resume
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
