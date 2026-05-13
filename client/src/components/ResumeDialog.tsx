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

  const [terminal, setTerminal] = useState('auto');
  const [useTmux, setUseTmux] = useState(false);
  const [tmuxAvailable, setTmuxAvailable] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);
  const [showCustom, setShowCustom] = useState(false);
  const [resuming, setResuming] = useState(false);

  const title = session.customTitle || session.summary || session.firstPrompt || session.sessionId.slice(0, 8);
  const tmuxName = `resume-${session.sessionId.slice(0, 8)}`;

  // Build commands from parts
  const buildClaudeCmd = (flags = '') => `cd ${cwd} && claude${flags} --resume ${session.sessionId}`;
  const wrapTmux = (cmd: string) =>
    `tmux new-session -d -s ${tmuxName} -c '${cwd}' && tmux send-keys -t ${tmuxName} '${cmd}; exit' Enter && tmux attach -t ${tmuxName}`;
  const buildCmd = (flags = '') => {
    const claude = buildClaudeCmd(flags);
    return useTmux ? wrapTmux(claude) : claude;
  };

  const baseCmd = buildCmd();
  const skipCmd = buildCmd(' --dangerously-skip-permissions');
  const [customCmd, setCustomCmd] = useState(baseCmd);
  const [customEdited, setCustomEdited] = useState(false);

  useEffect(() => {
    if (!customEdited) setCustomCmd(baseCmd);
  }, [useTmux, customEdited, baseCmd]);

  useEffect(() => {
    api.getPreferences().then((prefs) => {
      if (prefs.terminal && prefs.terminal !== 'tmux') setTerminal(prefs.terminal);
      if (prefs.terminal === 'tmux') setUseTmux(true);
      if (prefs.tmuxAvailable) setTmuxAvailable(true);
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
    if (resuming) return;
    setResuming(true);
    try { await api.setPreferences({ terminal }); } catch {}
    try {
      const terminalChoice = useTmux ? 'tmux' : terminal;
      const result = await api.resume(session.sessionId, skipPermissions, terminalChoice, useTmux ? terminal : undefined);
      if (useTmux && (result as any).tmuxSession) {
        const name = (result as any).tmuxSession;
        const msg = (result as any).alreadyRunning
          ? `Attaching to running session "${name}"...`
          : `tmux session "${name}" started, opening terminal...`;
        showToast(msg, 'success');
      } else {
        showToast('Session resumed in terminal', 'success');
      }
      onClose();
    } catch (err: any) {
      showToast(err.message, 'error');
      setResuming(false);
    }
  };

  const handleCustomResume = async () => {
    try { await api.setPreferences({ terminal }); } catch {}
    // For custom command, just copy to clipboard since we can't execute arbitrary commands
    navigator.clipboard.writeText(customCmd);
    showToast('Command copied to clipboard', 'success');
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

        {/* Terminal selector + tmux option */}
        <div className="flex items-center gap-4 mb-5">
          <div className="flex items-center gap-2">
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
          {tmuxAvailable && (
            <label className="flex items-center gap-1.5 text-xs cursor-pointer">
              <input
                type="checkbox"
                checked={useTmux}
                onChange={(e) => setUseTmux(e.target.checked)}
                className="cursor-pointer"
              />
              <span className={useTmux ? 'text-success' : 'text-text-muted'}>tmux</span>
              {!useTmux && <span className="text-[10px] text-text-muted/60">(supports detach/reattach)</span>}
            </label>
          )}
        </div>

        {/* Normal resume */}
        <div className="mb-4">
          <div className="text-xs text-text-muted mb-1.5">Resume command:</div>
          <div className="flex items-center gap-2">
            <input type="text" value={baseCmd} readOnly className="flex-1 px-3 py-2 bg-bg-primary border border-border rounded-md text-success text-xs font-mono focus:outline-none cursor-text select-all" onClick={(e) => (e.target as HTMLInputElement).select()} />
            <button
              onClick={() => handleCopy(baseCmd, 'base')}
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
        <div className="mb-4">
          <div className="text-xs text-warning mb-1.5">Skip permissions (dangerously auto-approve all tool calls):</div>
          <div className="flex items-center gap-2">
            <input type="text" value={skipCmd} readOnly className="flex-1 px-3 py-2 bg-bg-primary border border-border rounded-md text-warning text-xs font-mono focus:outline-none cursor-text select-all" onClick={(e) => (e.target as HTMLInputElement).select()} />
            <button
              onClick={() => handleCopy(skipCmd, 'skip')}
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

        {/* Custom toggle */}
        <button
          onClick={() => setShowCustom(!showCustom)}
          className={`text-[11px] mb-3 ${showCustom ? 'text-accent' : 'text-text-muted hover:text-accent'}`}
        >
          {showCustom ? '▼ Custom command' : '▶ Custom command'}
        </button>

        {/* Custom command area — hidden by default */}
        {showCustom && (
          <div className="border-t border-border pt-3">
            <div className="flex items-center gap-2">
              <input
                type="text"
                value={customCmd}
                onChange={(e) => { setCustomCmd(e.target.value); setCustomEdited(true); }}
                className="flex-1 px-3 py-2 bg-bg-primary border border-border rounded-md text-accent text-xs font-mono focus:outline-none focus:border-accent"
              />
              <button
                onClick={() => handleCopy(customCmd, 'custom')}
                className="shrink-0 px-3 py-2 text-[11px] border border-border rounded-md hover:bg-border text-text-muted"
              >
                {copied === 'custom' ? 'Copied!' : 'Copy'}
              </button>
              <button
                onClick={handleCustomResume}
                className="shrink-0 px-3 py-2 text-[11px] border border-accent text-accent rounded-md hover:bg-accent hover:text-black font-medium"
              >
                Copy & Run
              </button>
            </div>
            <div className="text-[10px] text-text-muted mt-2 space-y-1">
              <div>Available options:</div>
              <div className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 ml-2">
                <code className="text-accent">--model &lt;name&gt;</code><span>Use a specific model (e.g. claude-opus-4-6, claude-sonnet-4-5-20250514)</span>
                <code className="text-accent">--append-system-prompt &lt;text&gt;</code><span>Append extra system instructions</span>
                <code className="text-accent">--add-dir &lt;path&gt;</code><span>Add directory to session context</span>
                <code className="text-accent">--allowedTools &lt;tools&gt;</code><span>Restrict allowed tools (comma-separated)</span>
                <code className="text-accent">--dangerously-skip-permissions</code><span>Auto-approve all tool calls</span>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
