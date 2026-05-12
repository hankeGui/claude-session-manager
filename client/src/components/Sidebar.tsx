import { useStore } from '../store';

export default function Sidebar() {
  const projects = useStore((s) => s.projects);
  const sessions = useStore((s) => s.sessions);
  const currentProject = useStore((s) => s.currentProject);
  const setCurrentProject = useStore((s) => s.setCurrentProject);

  const visibleProjects = projects.filter((p) => p.sessionCount > 0);
  const totalSessions = projects.reduce((sum, p) => sum + p.sessionCount, 0);
  // Count favorites: when in favorites view use sessions.length, otherwise count from all projects
  const favCount = currentProject === '__favorites__'
    ? sessions.length
    : sessions.filter((s) => s.isFavorite).length;

  return (
    <aside className="w-[280px] min-w-[280px] bg-bg-secondary border-r border-border overflow-y-auto">
      <div className="px-4 py-3 font-semibold text-xs text-text-muted uppercase tracking-wider">
        Projects
      </div>
      <ul>
        <li
          className={`flex justify-between items-center px-4 py-2.5 cursor-pointer border-b border-border transition-colors hover:bg-bg-card ${
            !currentProject ? 'bg-bg-card border-l-[3px] border-l-accent' : ''
          }`}
          onClick={() => setCurrentProject(null)}
        >
          <span className="text-sm">All Projects</span>
          <span className="text-xs text-text-muted bg-bg-primary px-2 py-0.5 rounded-full">
            {totalSessions}
          </span>
        </li>
        <li
          className={`flex justify-between items-center px-4 py-2.5 cursor-pointer border-b border-border transition-colors hover:bg-bg-card ${
            currentProject === '__favorites__' ? 'bg-bg-card border-l-[3px] border-l-yellow-400' : ''
          }`}
          onClick={() => setCurrentProject('__favorites__')}
        >
          <span className="text-sm flex items-center gap-1.5">
            <span className="text-yellow-400">★</span> Favorites
          </span>
          {favCount > 0 && (
            <span className="text-xs text-text-muted bg-bg-primary px-2 py-0.5 rounded-full">
              {favCount}
            </span>
          )}
        </li>
        {visibleProjects.map((p) => (
          <li
            key={p.dirName}
            className={`flex justify-between items-center px-4 py-2.5 cursor-pointer border-b border-border transition-colors hover:bg-bg-card ${
              currentProject === p.dirName ? 'bg-bg-card border-l-[3px] border-l-accent' : ''
            }`}
            onClick={() => setCurrentProject(p.dirName)}
          >
            <span className="text-sm truncate mr-2">{p.displayName}</span>
            <span className="text-xs text-text-muted bg-bg-primary px-2 py-0.5 rounded-full shrink-0">
              {p.sessionCount}
              {p.emptyCount > 0 && <span className="text-warning ml-1">({p.emptyCount})</span>}
            </span>
          </li>
        ))}
      </ul>
    </aside>
  );
}
