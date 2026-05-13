import { useEffect } from 'react';
import { useStore } from './store';
import Header from './components/Header';
import SearchBar from './components/SearchBar';
import Sidebar from './components/Sidebar';
import SessionList from './components/SessionList';
import SchedulerView from './components/scheduler/SchedulerView';
import Toast from './components/Toast';
import ConfirmDialog from './components/ConfirmDialog';
import AiTaskIndicator from './components/AiTaskIndicator';
import BatchRenameIndicator from './components/BatchRenameIndicator';
import AiScanProgress from './components/AiScanProgress';

export default function App() {
  const loadStats = useStore((s) => s.loadStats);
  const loadProjects = useStore((s) => s.loadProjects);
  const loadSessions = useStore((s) => s.loadSessions);
  const currentView = useStore((s) => s.currentView);

  useEffect(() => {
    loadStats();
    loadProjects();
    loadSessions(null);
  }, [loadStats, loadProjects, loadSessions]);

  return (
    <div className="min-h-screen bg-bg-primary text-text-primary font-sans">
      <Header />
      {currentView === 'sessions' ? (
        <>
          <SearchBar />
          <main className="flex h-[calc(100vh-120px)]">
            <Sidebar />
            <SessionList />
          </main>
        </>
      ) : (
        <SchedulerView />
      )}
      <Toast />
      <ConfirmDialog />
      <AiTaskIndicator />
      <BatchRenameIndicator />
      <AiScanProgress />
    </div>
  );
}
