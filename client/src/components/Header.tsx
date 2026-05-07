import { useStore } from '../store';

export default function Header() {
  const stats = useStore((s) => s.stats);
  const refresh = useStore((s) => s.refresh);

  return (
    <header className="flex items-center justify-between px-6 py-4 bg-bg-secondary border-b border-border">
      <h1 className="text-lg font-semibold text-accent">Claude Session Manager</h1>
      <div className="flex items-center gap-3">
        {stats && (
          <span className="text-xs text-text-muted">
            {stats.totalProjects} projects / {stats.totalSessions} sessions
            {stats.emptySessions > 0 && ` / ${stats.emptySessions} empty`}
          </span>
        )}
        <button
          onClick={refresh}
          className="px-3 py-1.5 border border-border rounded-md bg-bg-card text-text-primary text-xs hover:bg-border"
        >
          Refresh
        </button>
      </div>
    </header>
  );
}
