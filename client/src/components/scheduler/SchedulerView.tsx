import { useEffect, useRef } from 'react';
import { useSchedulerStore } from '../../store/scheduler';
import TaskCard from './TaskCard';
import TaskForm from './TaskForm';

export default function SchedulerView() {
  const { tasks, showForm, loadTasks, setShowForm } = useSchedulerStore();
  const pollRef = useRef<number | null>(null);

  useEffect(() => {
    loadTasks();
  }, [loadTasks]);

  // Poll when tasks are active
  useEffect(() => {
    const hasActive = tasks.some(t => t.status === 'running' || t.status === 'pending');
    if (hasActive) {
      pollRef.current = window.setInterval(() => loadTasks(), 3000);
    }
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [tasks, loadTasks]);

  const cronTasks = tasks.filter(t => t.scheduleType === 'cron' && t.status === 'running');
  const pendingTasks = tasks.filter(t => t.status === 'pending');
  const historyTasks = tasks.filter(t =>
    t.status === 'completed' || t.status === 'failed' || t.status === 'cancelled' ||
    (t.status === 'running' && t.scheduleType !== 'cron')
  );

  return (
    <main className="h-[calc(100vh-56px)] overflow-y-auto px-6 py-5">
      <div className="max-w-4xl mx-auto">
        <div className="flex items-center justify-between mb-5">
          <h2 className="text-base font-semibold text-text-primary">Scheduled Tasks</h2>
          <button
            onClick={() => setShowForm(true)}
            className="px-4 py-2 bg-accent text-white text-xs font-medium rounded-md hover:bg-accent/80"
          >
            + New Task
          </button>
        </div>

        {showForm && <TaskForm />}

        {tasks.length === 0 && !showForm && (
          <div className="text-center py-16 text-text-muted">
            <p className="text-sm">No scheduled tasks yet.</p>
            <p className="text-xs mt-1">Create a task to run Claude on a schedule or immediately.</p>
          </div>
        )}

        {cronTasks.length > 0 && (
          <Section title="Recurring (Cron)" count={cronTasks.length}>
            {cronTasks.map(t => <TaskCard key={t.id} task={t} />)}
          </Section>
        )}

        {pendingTasks.length > 0 && (
          <Section title="Pending" count={pendingTasks.length}>
            {pendingTasks.map(t => <TaskCard key={t.id} task={t} />)}
          </Section>
        )}

        {historyTasks.length > 0 && (
          <Section title="History" count={historyTasks.length}>
            {historyTasks.map(t => <TaskCard key={t.id} task={t} />)}
          </Section>
        )}
      </div>
    </main>
  );
}

function Section({ title, count, children }: { title: string; count: number; children: React.ReactNode }) {
  return (
    <div className="mb-6">
      <h3 className="text-xs font-semibold text-text-muted uppercase mb-2">
        {title} ({count})
      </h3>
      <div className="flex flex-col gap-2">{children}</div>
    </div>
  );
}
