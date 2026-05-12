import { useState } from 'react';
import { useStore, AppView } from '../store';

const tabs: { id: AppView; label: string }[] = [
  { id: 'sessions', label: 'Sessions' },
  { id: 'scheduler', label: 'Scheduler' },
];

export default function Header() {
  const stats = useStore((s) => s.stats);
  const refresh = useStore((s) => s.refresh);
  const currentView = useStore((s) => s.currentView);
  const setView = useStore((s) => s.setView);
  const [refreshState, setRefreshState] = useState<'idle' | 'loading' | 'done'>('idle');

  const handleRefresh = async () => {
    setRefreshState('loading');
    await refresh();
    setRefreshState('done');
    setTimeout(() => setRefreshState('idle'), 2000);
  };

  return (
    <header className="flex items-center justify-between px-6 py-3 bg-bg-secondary border-b border-border">
      <div className="flex items-center gap-6">
        <h1 className="text-lg font-semibold text-accent">Claude Session Manager</h1>
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
        {refreshState === 'done' && (
          <span className="text-xs text-green-400">Refreshed</span>
        )}
        <button
          onClick={handleRefresh}
          disabled={refreshState === 'loading'}
          className="px-3 py-1.5 border border-border rounded-md bg-bg-card text-text-primary text-xs hover:bg-border disabled:opacity-50"
        >
          {refreshState === 'loading' ? 'Refreshing...' : 'Refresh'}
        </button>
      </div>
    </header>
  );
}
