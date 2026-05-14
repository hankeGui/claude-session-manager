import { useState, useEffect } from 'react';
import { useStore, AppView } from '../store';
import { api, UpdateInfo } from '../api';
import { confirm } from './ConfirmDialog';
import { showToast } from './Toast';
import AiConfigDialog from './AiConfigDialog';

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
  const aiScanStatus = useStore((s) => s.aiScanStatus);
  const currentView = useStore((s) => s.currentView);
  const setView = useStore((s) => s.setView);
  const setShowAiConfig = useStore((s) => s.setShowAiConfig);
  const [rescanState, setRescanState] = useState<'idle' | 'loading' | 'done'>('idle');
  const [updateState, setUpdateState] = useState<'idle' | 'checking' | 'done' | 'error'>('idle');
  const [updateInfo, setUpdateInfo] = useState<UpdateInfo | null>(null);
  const [aiStatus, setAiStatus] = useState<'unknown' | 'ok' | 'configured' | 'none'>('unknown');

  useEffect(() => {
    // Use server-side configValid (set during boot verification) to avoid redundant API call
    api.getAiScanStatus().then((s) => {
      if (s.configValid === true) {
        setAiStatus('ok');
      } else if (s.configValid === false) {
        // Config exists but failed verification, or not configured at all
        api.getAiSettings().then((settings) => {
          setAiStatus(settings.isConfigured ? 'configured' : 'none');
        }).catch(() => setAiStatus('none'));
      } else {
        // Unknown — fall back to manual check
        api.getAiSettings().then((settings) => {
          if (!settings.isConfigured) { setAiStatus('none'); return; }
          setAiStatus('configured');
          api.verifyAiConnection().then((r) => setAiStatus(r.ok ? 'ok' : 'configured')).catch(() => {});
        }).catch(() => setAiStatus('none'));
      }
    }).catch(() => setAiStatus('none'));
  }, []);

  const handleRescan = async () => {
    if (aiStatus === 'none') {
      setShowAiConfig(true);
      return;
    }

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
          disabled={rescanState === 'loading' || !!aiScanStatus?.running}
          className="px-3 py-1.5 border border-border rounded-md bg-bg-card text-text-primary text-xs hover:bg-border disabled:opacity-50"
        >
          {rescanState === 'loading' || aiScanStatus?.running ? 'Extracting...' : 'AI Re-Extract'}
        </button>
        <button
          onClick={() => setShowAiConfig(true)}
          className={`w-7 h-7 flex items-center justify-center rounded-md border border-border bg-bg-card hover:bg-border transition-colors ${
            aiStatus === 'ok' ? 'text-green-400 hover:text-green-300' :
            aiStatus === 'configured' ? 'text-amber-400 hover:text-amber-300' :
            aiStatus === 'none' ? 'text-red-400 hover:text-red-300' :
            'text-text-muted hover:text-text-primary'
          }`}
          title={
            aiStatus === 'ok' ? 'AI Settings (connected)' :
            aiStatus === 'configured' ? 'AI Settings (configured but not reachable)' :
            aiStatus === 'none' ? 'AI Settings (not configured)' : 'AI Settings'
          }
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="3" />
            <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
          </svg>
        </button>
      </div>
      <AiConfigDialog onSaved={() => setAiStatus('ok')} />
    </header>
  );
}
