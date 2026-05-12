import { useState, useEffect, useRef } from 'react';
import { useSchedulerStore } from '../../store/scheduler';
import { ScheduledTask, schedulerApi } from '../../api/scheduler';

function getNextRuns(cronExpr: string, count = 3): Date[] {
  const parts = cronExpr.split(' ');
  if (parts.length !== 5) return [];
  const [minP, hourP, domP, , dowP] = parts;
  const now = new Date();
  const results: Date[] = [];
  for (let offset = 1; offset < 60 * 24 * 35 && results.length < count; offset++) {
    const c = new Date(now.getTime() + offset * 60000);
    if (!mf(minP, c.getMinutes())) continue;
    if (!mf(hourP, c.getHours())) continue;
    if (!mf(domP, c.getDate())) continue;
    if (!mfDow(dowP, c.getDay())) continue;
    results.push(c);
  }
  return results;
}
function mf(p: string, v: number): boolean {
  if (p === '*') return true;
  if (p.startsWith('*/')) return v % parseInt(p.slice(2)) === 0;
  if (p.includes(',')) return p.split(',').some(x => parseInt(x) === v);
  if (p.includes('-')) { const [a, b] = p.split('-').map(Number); return v >= a && v <= b; }
  return parseInt(p) === v;
}
function mfDow(p: string, v: number): boolean {
  if (p === '*') return true;
  if (p.includes('-')) { const [a, b] = p.split('-').map(Number); return v >= a && v <= b; }
  if (p.includes(',')) return p.split(',').some(x => parseInt(x) === v);
  return parseInt(p) === v;
}

interface Props {
  task: ScheduledTask;
}

const statusStyles: Record<string, string> = {
  pending: 'bg-yellow-500/15 text-yellow-400',
  running: 'bg-blue-500/15 text-blue-400',
  completed: 'bg-green-500/15 text-green-400',
  failed: 'bg-red-500/15 text-red-400',
  cancelled: 'bg-neutral-500/15 text-neutral-400',
};

function formatTime(iso: string | null) {
  if (!iso) return '';
  return new Date(iso).toLocaleString();
}

export default function TaskCard({ task }: Props) {
  const { deleteTask, runNow, cancelTask, setEditingTask } = useSchedulerStore();
  const [showOutput, setShowOutput] = useState(false);
  const [liveStdout, setLiveStdout] = useState('');
  const [liveStderr, setLiveStderr] = useState('');
  const pollRef = useRef<number | null>(null);

  const [attachError, setAttachError] = useState('');
  const isCron = task.scheduleType === 'cron';
  const isRunning = task.status === 'running' && !isCron;
  const hasTmux = !!task.tmuxSession;

  const handleAttach = async () => {
    setAttachError('');
    try {
      await schedulerApi.attachTmux(task.id);
    } catch (err: any) {
      setAttachError(err.message || 'Failed to attach');
      setTimeout(() => setAttachError(''), 3000);
    }
  };

  // Poll live output when running task is expanded (including tmux tasks)
  useEffect(() => {
    if (showOutput && (isRunning || (isCron && task.status === 'running'))) {
      const poll = async () => {
        try {
          const data = await schedulerApi.getOutput(task.id);
          setLiveStdout(data.stdout);
          setLiveStderr(data.stderr);
        } catch {}
      };
      poll();
      pollRef.current = window.setInterval(poll, 2000);
    }
    return () => {
      if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
    };
  }, [showOutput, isRunning, isCron, task.status, task.id]);

  return (
    <div className="border border-border rounded-md bg-bg-secondary p-3">
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1 flex-wrap">
            <span className={`text-[10px] font-semibold uppercase px-1.5 py-0.5 rounded ${statusStyles[task.status]}`}>
              {isCron && task.status === 'running' ? 'active' : task.status}
            </span>
            {isRunning && (
              <span className="inline-block w-2 h-2 bg-blue-400 rounded-full animate-pulse" />
            )}
            {isCron && (
              <span className="text-[10px] bg-purple-500/15 text-purple-400 px-1.5 py-0.5 rounded font-mono">
                {task.cron}
              </span>
            )}
            {task.scheduleType === 'once' && (
              <span className="text-[10px] text-text-muted">once</span>
            )}
            {task.model && (
              <span className="text-[10px] text-text-muted">{task.model}</span>
            )}
            {task.skipPermissions && (
              <span className="text-[10px] text-yellow-500">skip-perms</span>
            )}
            {task.openInTerminal && !hasTmux && (
              <span className="text-[10px] text-cyan-400">terminal</span>
            )}
            {hasTmux && (
              <span className="text-[10px] bg-cyan-500/15 text-cyan-400 px-1.5 py-0.5 rounded font-mono">
                tmux:{task.tmuxSession}
              </span>
            )}
            {isCron && task.runCount > 0 && (
              <span className="text-[10px] text-text-muted">runs: {task.runCount}</span>
            )}
          </div>
          <p className="text-sm text-text-primary truncate" title={task.prompt}>
            {task.prompt}
          </p>
          {/* Cron execution details */}
          {isCron && task.status === 'running' && (
            <div className="mt-2 text-[10px] text-text-muted space-y-1">
              <div className="flex gap-4 flex-wrap">
                <span>Total runs: <strong className="text-text-primary">{task.runCount}</strong></span>
                {task.lastRunAt && <span>Last: {formatTime(task.lastRunAt)}</span>}
                <span>Created: {formatTime(task.createdAt)}</span>
              </div>
              {task.runHistory && task.runHistory.length > 1 && (
                <div>
                  <span className="text-text-muted">Recent: </span>
                  {task.runHistory.slice(-5).reverse().map((t, i) => (
                    <span key={i} className="mr-2">{new Date(t).toLocaleTimeString()}</span>
                  ))}
                </div>
              )}
              {task.cron && (
                <div>
                  <span className="text-text-muted">Next: </span>
                  {getNextRuns(task.cron, 3).map((d, i) => (
                    <span key={i} className="mr-2">{d.toLocaleString()}</span>
                  ))}
                </div>
              )}
              {task.workingDirectory && <div>Dir: {task.workingDirectory}</div>}
            </div>
          )}
          {/* Non-cron info */}
          {!isCron && (
            <div className="flex gap-3 mt-1 text-[10px] text-text-muted flex-wrap">
              {task.scheduledAt && task.scheduleType === 'once' && <span>Scheduled: {formatTime(task.scheduledAt)}</span>}
              {task.lastRunAt && <span>Last run: {formatTime(task.lastRunAt)}</span>}
              {!task.lastRunAt && !task.scheduledAt && <span>Created: {formatTime(task.createdAt)}</span>}
              {task.workingDirectory && <span>Dir: {task.workingDirectory}</span>}
            </div>
          )}
          {/* Cron non-running info (pending/completed/etc) */}
          {isCron && task.status !== 'running' && (
            <div className="flex gap-3 mt-1 text-[10px] text-text-muted flex-wrap">
              {task.lastRunAt && <span>Last run: {formatTime(task.lastRunAt)}</span>}
              <span>Runs: {task.runCount}</span>
              <span>Created: {formatTime(task.createdAt)}</span>
              {task.workingDirectory && <span>Dir: {task.workingDirectory}</span>}
            </div>
          )}
        </div>

        <div className="flex gap-1.5 shrink-0">
          {task.status === 'pending' && (
            <>
              <ActionBtn onClick={() => runNow(task.id)} label="Run" />
              <ActionBtn onClick={() => setEditingTask(task)} label="Edit" />
              <ActionBtn onClick={() => deleteTask(task.id)} label="Del" danger />
            </>
          )}
          {isRunning && (
            <>
              {hasTmux && <ActionBtn onClick={handleAttach} label="Attach" />}
              <ActionBtn onClick={() => setShowOutput(!showOutput)} label={showOutput ? 'Hide' : 'Live'} />
              <ActionBtn onClick={() => cancelTask(task.id)} label="Cancel" danger />
            </>
          )}
          {task.status === 'running' && isCron && (
            <>
              {hasTmux && <ActionBtn onClick={handleAttach} label="Attach" />}
              <ActionBtn onClick={() => runNow(task.id)} label="Run Now" />
              <ActionBtn onClick={() => setEditingTask(task)} label="Edit" />
              <ActionBtn onClick={() => setShowOutput(!showOutput)} label={showOutput ? 'Hide' : 'Output'} />
              <ActionBtn onClick={() => cancelTask(task.id)} label="Stop" danger />
            </>
          )}
          {(task.status === 'completed' || task.status === 'failed') && (
            <>
              <ActionBtn onClick={() => setShowOutput(!showOutput)} label={showOutput ? 'Hide' : 'Output'} />
              <ActionBtn onClick={() => setEditingTask(task)} label="Edit" />
              <ActionBtn onClick={() => deleteTask(task.id)} label="Del" danger />
            </>
          )}
          {task.status === 'cancelled' && (
            <>
              <ActionBtn onClick={() => setEditingTask(task)} label="Edit" />
              <ActionBtn onClick={() => deleteTask(task.id)} label="Del" danger />
            </>
          )}
        </div>
      </div>

      {attachError && (
        <p className="mt-1 text-[11px] text-red-400">{attachError}</p>
      )}

      {showOutput && (
        <div className="mt-3 border-t border-border pt-2">
          {isRunning ? (
            <>
              {liveStderr && (
                <pre className="text-xs text-red-400 bg-red-500/5 p-2 rounded overflow-x-auto max-h-[200px] overflow-y-auto whitespace-pre-wrap mb-2">
                  {liveStderr}
                </pre>
              )}
              <pre className="text-xs text-text-primary bg-bg-card p-2 rounded overflow-x-auto max-h-[300px] overflow-y-auto whitespace-pre-wrap">
                {liveStdout || <span className="text-text-muted italic">Waiting for output...</span>}
              </pre>
            </>
          ) : (
            <>
              {task.error && (
                <pre className="text-xs text-red-400 bg-red-500/5 p-2 rounded overflow-x-auto max-h-[200px] overflow-y-auto whitespace-pre-wrap mb-2">
                  {task.error}
                </pre>
              )}
              {task.output && (
                <pre className="text-xs text-text-primary bg-bg-card p-2 rounded overflow-x-auto max-h-[300px] overflow-y-auto whitespace-pre-wrap">
                  {task.output}
                </pre>
              )}
              {!task.output && !task.error && (
                <p className="text-xs text-text-muted italic">No output</p>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}

function ActionBtn({ onClick, label, danger }: { onClick: () => void; label: string; danger?: boolean }) {
  return (
    <button
      onClick={onClick}
      className={`px-2 py-1 text-[10px] border rounded ${
        danger
          ? 'border-red-500/30 text-red-400 hover:bg-red-500/10'
          : 'border-border text-text-muted hover:text-text-primary hover:bg-bg-card'
      }`}
    >
      {label}
    </button>
  );
}
