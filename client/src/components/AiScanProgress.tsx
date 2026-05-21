import { useEffect } from 'react';
import { useStore } from '../store';
import { api } from '../api';

export default function AiScanProgress() {
  const aiScanStatus = useStore((s) => s.aiScanStatus);
  const startAiScanPoll = useStore((s) => s.startAiScanPoll);
  const setShowAiConfig = useStore((s) => s.setShowAiConfig);
  const dismissAiScanError = useStore((s) => s.dismissAiScanError);

  useEffect(() => {
    startAiScanPoll();
  }, []);

  if (!aiScanStatus) return null;

  const { running, paused, cancelled, phase, total, done, error, result } = aiScanStatus;
  const progress = total > 0 ? Math.round((done / total) * 100) : 0;

  const phaseName = phase === 'summary' ? 'Summaries' : phase === 'rename' ? 'Rename' : '';
  const phaseLabel = paused
    ? `Paused — ${phaseName}`
    : phase === 'summary'
      ? 'Generating summaries...'
      : phase === 'rename'
        ? 'Auto-renaming...'
        : 'Complete';

  const handlePause = () => api.pauseAiScan();
  const handleResume = () => api.resumeAiScan();
  const handleStop = () => api.stopAiScan();
  const handleDismiss = () => dismissAiScanError();

  // Error state
  if (!running && error) {
    return (
      <div className="fixed bottom-4 right-4 w-[300px] bg-bg-secondary border border-red-500/50 rounded-lg shadow-lg z-[150] overflow-hidden">
        <div className="px-4 py-3">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-medium text-red-400">AI Extract Failed</span>
            <button
              onClick={handleDismiss}
              className="w-5 h-5 flex items-center justify-center rounded hover:bg-bg-card text-text-muted hover:text-text-primary transition-colors"
              title="Dismiss"
            >
              <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.5">
                <path d="M1.5 1.5L8.5 8.5M8.5 1.5L1.5 8.5" />
              </svg>
            </button>
          </div>
          <p className="text-[11px] text-text-muted mb-3 line-clamp-2">{error}</p>
          <div className="flex gap-2">
            <button
              onClick={() => { handleDismiss(); setShowAiConfig(true); }}
              className="px-2.5 py-1 text-[11px] bg-accent/15 text-accent rounded hover:bg-accent/25 transition-colors"
            >
              Configure AI
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed bottom-4 right-4 w-[280px] bg-bg-secondary border border-border rounded-lg shadow-lg z-[150] overflow-hidden">
      <div className="px-4 py-2.5 flex items-center justify-between">
        <span className="text-xs font-medium text-text-primary">
          {running ? phaseLabel : cancelled ? 'Cancelled' : 'AI processing complete'}
        </span>
        {running && (
          <div className="flex items-center gap-1.5">
            <span className="text-[11px] text-text-muted">
              {done}/{total}
            </span>
            {paused ? (
              <button
                onClick={handleResume}
                className="w-5 h-5 flex items-center justify-center rounded hover:bg-bg-card text-text-muted hover:text-green-400 transition-colors"
                title="Resume"
              >
                <svg width="10" height="10" viewBox="0 0 10 10" fill="currentColor">
                  <polygon points="2,0 10,5 2,10" />
                </svg>
              </button>
            ) : (
              <button
                onClick={handlePause}
                className="w-5 h-5 flex items-center justify-center rounded hover:bg-bg-card text-text-muted hover:text-amber-400 transition-colors"
                title="Pause"
              >
                <svg width="10" height="10" viewBox="0 0 10 10" fill="currentColor">
                  <rect x="1" y="0" width="3" height="10" />
                  <rect x="6" y="0" width="3" height="10" />
                </svg>
              </button>
            )}
            <button
              onClick={handleStop}
              className="w-5 h-5 flex items-center justify-center rounded hover:bg-bg-card text-text-muted hover:text-red-400 transition-colors"
              title="Cancel"
            >
              <svg width="10" height="10" viewBox="0 0 10 10" fill="currentColor">
                <path d="M1.5 0.5L9.5 8.5M9.5 0.5L1.5 8.5" stroke="currentColor" strokeWidth="1.5" fill="none" />
              </svg>
            </button>
          </div>
        )}
      </div>
      {running && (
        <div className="px-4 pb-3">
          <div className="w-full h-1.5 bg-bg-primary rounded-full overflow-hidden">
            <div
              className={`h-full rounded-full transition-all duration-300 ${paused ? 'bg-amber-400' : 'bg-accent'}`}
              style={{ width: `${progress}%` }}
            />
          </div>
        </div>
      )}
      {!running && cancelled && (
        <div className="px-4 pb-3 text-[11px] text-text-muted">
          Completed {done}/{total} before cancellation
        </div>
      )}
      {!running && !cancelled && result && (
        <div className="px-4 pb-3 text-[11px] text-text-muted">
          {result.summaries > 0 && <span>{result.summaries} summaries</span>}
          {result.summaries > 0 && result.titles > 0 && <span>, </span>}
          {result.titles > 0 && <span>{result.titles} titles</span>}
          {(result.summaries > 0 || result.titles > 0) && <span> generated</span>}
          {result.skipped > 0 && <span> ({result.skipped} cached)</span>}
          {result.summaries === 0 && result.titles === 0 && <span>All up to date</span>}
        </div>
      )}
    </div>
  );
}
