import { useState } from 'react';
import { Session } from '../api';
import { useStore } from '../store';
import SessionCard from './SessionCard';
import SessionModal from './SessionModal';
import { confirm } from './ConfirmDialog';
import { showToast } from './Toast';

export default function SessionList() {
  const sessions = useStore((s) => s.sessions);
  const selected = useStore((s) => s.selected);
  const loading = useStore((s) => s.loading);
  const selectAll = useStore((s) => s.selectAll);
  const batchDelete = useStore((s) => s.batchDelete);
  const searchQuery = useStore((s) => s.searchQuery);
  const doDeepSearch = useStore((s) => s.doDeepSearch);
  const currentProject = useStore((s) => s.currentProject);
  const [viewSession, setViewSession] = useState<Session | null>(null);
  const [deepSearching, setDeepSearching] = useState(false);

  const handleBatchDelete = async () => {
    const { confirmed } = await confirm({
      title: 'Batch Delete',
      message: `Delete ${selected.size} selected sessions? This cannot be undone.`,
      okText: 'Delete All',
    });
    if (!confirmed) return;
    try {
      const result = await batchDelete();
      showToast(`Deleted ${result.deleted} sessions${result.failed ? `, ${result.failed} failed` : ''}`, 'success');
    } catch (err: any) {
      showToast(err.message, 'error');
    }
  };

  const handleDeepSearch = async () => {
    setDeepSearching(true);
    try {
      const results = await doDeepSearch(searchQuery);
      showToast(`AI found ${results.length} matching sessions`, 'info');
    } catch (err: any) {
      showToast(`AI search failed: ${err.message}`, 'error');
    } finally {
      setDeepSearching(false);
    }
  };

  const allSelected = sessions.length > 0 && selected.size === sessions.length;

  return (
    <div className="flex-1 overflow-y-auto p-5">
      {/* Batch actions */}
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-base font-medium">
          {currentProject ? '' : 'Select a project'}
          {sessions.length > 0 && `${sessions.length} sessions`}
        </h2>
        {sessions.length > 0 && (
          <div className="flex gap-2 items-center">
            <button
              onClick={selectAll}
              className="px-3 py-1.5 border border-border rounded-md bg-bg-card text-text-primary text-xs hover:bg-border"
            >
              {allSelected ? 'Unselect All' : 'Select All'}
            </button>
            {selected.size > 0 && (
              <button
                onClick={handleBatchDelete}
                className="px-3 py-1.5 border border-danger rounded-md text-danger text-xs hover:bg-danger hover:text-white"
              >
                Delete ({selected.size})
              </button>
            )}
          </div>
        )}
      </div>

      {/* Loading */}
      {loading && (
        <div className="text-center text-text-muted py-8">Loading...</div>
      )}

      {/* Session cards */}
      {!loading && sessions.map((s) => (
        <SessionCard key={s.sessionId} session={s} onView={setViewSession} />
      ))}

      {/* No results + deep search */}
      {!loading && sessions.length === 0 && searchQuery && (
        <div className="text-center py-8">
          <p className="text-text-muted mb-4">No sessions found for "{searchQuery}"</p>
          <button
            onClick={handleDeepSearch}
            disabled={deepSearching}
            className="px-4 py-2 border border-accent rounded-md text-accent text-sm hover:bg-accent hover:text-black disabled:opacity-50"
          >
            {deepSearching ? 'AI Searching...' : 'AI Deep Search'}
          </button>
        </div>
      )}

      {/* Empty state */}
      {!loading && sessions.length === 0 && !searchQuery && currentProject && (
        <div className="text-center text-text-muted py-8">No sessions in this project</div>
      )}

      {/* Modal */}
      {viewSession && (
        <SessionModal session={viewSession} onClose={() => setViewSession(null)} />
      )}
    </div>
  );
}
