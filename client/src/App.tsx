import { useEffect } from 'react';
import { useStore } from './store';
import Header from './components/Header';
import SearchBar from './components/SearchBar';
import Sidebar from './components/Sidebar';
import SessionList from './components/SessionList';
import Toast from './components/Toast';
import ConfirmDialog from './components/ConfirmDialog';
import AiTaskIndicator from './components/AiTaskIndicator';

export default function App() {
  const loadStats = useStore((s) => s.loadStats);
  const loadProjects = useStore((s) => s.loadProjects);
  const loadSessions = useStore((s) => s.loadSessions);

  useEffect(() => {
    loadStats();
    loadProjects();
    loadSessions(null);
  }, [loadStats, loadProjects, loadSessions]);

  return (
    <div className="min-h-screen bg-bg-primary text-text-primary font-sans">
      <Header />
      <SearchBar />
      <main className="flex h-[calc(100vh-120px)]">
        <Sidebar />
        <SessionList />
      </main>
      <Toast />
      <ConfirmDialog />
      <AiTaskIndicator />
    </div>
  );
}
