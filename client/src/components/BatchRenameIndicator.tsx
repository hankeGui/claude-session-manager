import { useStore } from '../store';

export default function BatchRenameIndicator() {
  const batchRename = useStore((s) => s.batchRename);
  const dismissBatchRename = useStore((s) => s.dismissBatchRename);

  if (!batchRename) return null;

  const { running, total, done, failed, skipped, results } = batchRename;
  const progress = total > 0 ? Math.round(((done + failed) / total) * 100) : 0;

  return (
    <div className="fixed bottom-4 right-4 w-[340px] bg-bg-secondary border border-border rounded-lg shadow-lg z-[150] overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-2.5 border-b border-border">
        <span className="text-sm font-medium">
          {running ? 'AI Renaming...' : 'Rename Complete'}
        </span>
        {!running && (
          <button
            onClick={dismissBatchRename}
            className="text-text-muted hover:text-text-primary text-lg leading-none"
          >
            &times;
          </button>
        )}
      </div>

      {/* Progress bar */}
      <div className="px-4 pt-2">
        <div className="w-full h-1.5 bg-bg-primary rounded-full overflow-hidden">
          <div
            className="h-full bg-accent rounded-full transition-all duration-300"
            style={{ width: `${progress}%` }}
          />
        </div>
        <div className="flex justify-between text-[11px] text-text-muted mt-1">
          <span>{done + failed} / {total}</span>
          <span>
            {done > 0 && <span className="text-success">{done} renamed</span>}
            {failed > 0 && <span className="text-danger ml-2">{failed} failed</span>}
            {skipped > 0 && <span className="ml-2">{skipped} skipped</span>}
          </span>
        </div>
      </div>

      {/* Recent results */}
      <div className="px-4 py-2 max-h-[160px] overflow-y-auto">
        {results.slice(-8).reverse().map((r, i) => (
          <div key={i} className="flex items-center gap-2 text-[11px] py-0.5">
            <span className={r.status === 'done' ? 'text-success' : r.status === 'skipped' ? 'text-text-muted' : 'text-danger'}>
              {r.status === 'done' ? '✓' : r.status === 'skipped' ? '⊘' : '✗'}
            </span>
            <span className="truncate text-text-muted">
              {r.status === 'skipped' ? `${r.sessionId.slice(0, 8)} · ${r.title}` : (r.title || r.sessionId.slice(0, 8))}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
