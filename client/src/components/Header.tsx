import { useState } from 'react';
import { useStore, AppView } from '../store';
import { api, UpdateInfo } from '../api';
import { confirm } from './ConfirmDialog';
import { showToast } from './Toast';

const tabs: { id: AppView; label: string }[] = [
  { id: 'sessions', label: 'Sessions' },
  { id: 'scheduler', label: 'Scheduler' },
];

// Expose clearCache to browser console
if (typeof window !== 'undefined') {
  (window as any).clearCache = async () => {
    const res = await fetch('/api/clear-cache', { method: 'POST' });
    const data = await res.json();
    console.log('%c✓ Cache cleared:', 'color: #4ade80', data.cleared.join(', '));
    console.log('  Reload the page or click Rescan to refresh data.');
    return data;
  };
  console.log('%c💡 Tip: run clearCache() to clear all titles, tags, and AI summaries', 'color: #9ca3af');
}

export default function Header() {
  const stats = useStore((s) => s.stats);
  const refresh = useStore((s) => s.refresh);
  const currentView = useStore((s) => s.currentView);
  const setView = useStore((s) => s.setView);
  const [rescanState, setRescanState] = useState<'idle' | 'loading' | 'done'>('idle');
  const [updateState, setUpdateState] = useState<'idle' | 'checking' | 'done' | 'error'>('idle');
  const [updateInfo, setUpdateInfo] = useState<UpdateInfo | null>(null);

  const handleRescan = async () => {
    setRescanState('loading');
    const result = await refresh();
    setRescanState('idle');

    const { summaries, titles } = result.pending;

    if (summaries === 0 && titles === 0) {
      // All cached — ask user if they want to force re-extract
      const estimated = result.sessions * 2;
      const { confirmed: ok } = await confirm({
        title: 'All Up To Date',
        message: `All sessions already have cached summaries and titles.\n\nForce re-extract will clear all caches and regenerate from scratch.\nEstimated API calls: ~${estimated} (${result.sessions} sessions × 2)\n\nThis is resource-intensive. Use with caution.`,
        okText: 'Force Re-extract',
        okClass: 'warning',
      });
      if (!ok) return;
      setRescanState('loading');
      const forceResult = await api.forceRescan();
      showToast(`Re-extracting ${forceResult.pending.summaries} summaries + ${forceResult.pending.titles} titles...`, 'info');
    } else {
      // Has pending — confirm before starting
      const details: string[] = [];
      if (summaries > 0) details.push(`${summaries} summary`);
      if (titles > 0) details.push(`${titles} title`);
      const { confirmed: ok } = await confirm({
        title: 'AI Extract',
        message: `Found ${details.join(' + ')} to generate.\nEstimated API calls: ~${summaries + titles}`,
        okText: 'Start',
        okClass: 'success',
      });
      if (!ok) return;
      setRescanState('loading');
      await api.startAiScan();
    }

    setRescanState('done');
    setTimeout(() => setRescanState('idle'), 2000);
  };

  const handleCheckUpdate = async () => {
    setUpdateState('checking');
    try {
      const info = await api.checkUpdate();
      setUpdateInfo(info);
      setUpdateState('done');
      if (!info.hasUpdate) {
        setTimeout(() => setUpdateState('idle'), 3000);
      }
    } catch {
      setUpdateState('error');
      setTimeout(() => setUpdateState('idle'), 3000);
    }
  };

  return (
    <header className="flex items-center justify-between px-6 py-3 bg-bg-secondary border-b border-border">
      <div className="flex items-center gap-6">
        <div className="flex items-center gap-2">
          <h1 className="text-lg font-semibold text-accent">Claude Session Manager</h1>
          {stats?.version && (
            <span className="text-xs text-text-muted">v{stats.version}</span>
          )}
          <button
            onClick={handleCheckUpdate}
            disabled={updateState === 'checking'}
            className="text-[10px] text-text-muted hover:text-accent transition-colors disabled:opacity-50"
          >
            {updateState === 'checking' ? '...' : 'Check Update'}
          </button>
          {updateState === 'done' && updateInfo?.hasUpdate && (
            <span className="text-[10px] text-green-400">
              v{updateInfo.latest} available · restart with <code>npx -y claude-session-mgr@latest</code>
            </span>
          )}
          {updateState === 'done' && updateInfo && !updateInfo.hasUpdate && (
            <span className="text-[10px] text-text-muted">Up to date</span>
          )}
          {updateState === 'error' && (
            <span className="text-[10px] text-red-400">Check failed</span>
          )}
        </div>
        <nav className="flex gap-1">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setView(tab.id)}
              className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
                currentView === tab.id
                  ? 'bg-accent/15 text-accent'
                  : 'text-text-muted hover:text-text-primary hover:bg-bg-card'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </nav>
      </div>
      <div className="flex items-center gap-3">
        {stats && (
          <span className="text-xs text-text-muted">
            {stats.totalProjects} projects / {stats.totalSessions} sessions
            {stats.emptySessions > 0 && ` / ${stats.emptySessions} empty`}
          </span>
        )}
        {rescanState === 'done' && (
          <span className="text-xs text-green-400">Done</span>
        )}
        <button
          onClick={handleRescan}
          disabled={rescanState === 'loading'}
          className="px-3 py-1.5 border border-border rounded-md bg-bg-card text-text-primary text-xs hover:bg-border disabled:opacity-50"
        >
          {rescanState === 'loading' ? 'Extracting...' : 'AI Re-Extract'}
        </button>
      </div>
    </header>
  );
}
