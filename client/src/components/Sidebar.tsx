import { useStore } from '../store';

export default function Sidebar() {
  const projects = useStore((s) => s.projects);
  const currentProject = useStore((s) => s.currentProject);
  const setCurrentProject = useStore((s) => s.setCurrentProject);

  const visibleProjects = projects.filter((p) => p.sessionCount > 0);
  const totalSessions = projects.reduce((sum, p) => sum + p.sessionCount, 0);

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
