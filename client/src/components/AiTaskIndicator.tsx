import { useStore } from '../store';

export default function AiTaskIndicator() {
  const aiTask = useStore((s) => s.aiTask);
  const minimized = useStore((s) => s.aiTaskMinimized);
  const dismiss = useStore((s) => s.dismissAiTask);
  const toggle = useStore((s) => s.toggleAiTaskMinimized);

  if (!aiTask) return null;

  if (minimized) {
    return (
      <div
        className="fixed bottom-4 right-4 z-[100] bg-bg-secondary border border-accent rounded-full px-4 py-2 cursor-pointer shadow-lg flex items-center gap-2"
        onClick={toggle}
      >
        {aiTask.status === 'running' && (
          <span className="inline-block w-3 h-3 border-2 border-accent border-t-transparent rounded-full animate-spin" />
        )}
        {aiTask.status === 'done' && <span className="text-success">&#10003;</span>}
        {aiTask.status === 'error' && <span className="text-danger">&#10007;</span>}
        <span className="text-xs text-text-primary">AI Rename</span>
      </div>
    );
  }

  return (
    <div className="fixed bottom-4 right-4 z-[100] bg-bg-secondary border border-border rounded-lg shadow-lg w-80">
      <div className="flex items-center justify-between px-3 py-2 border-b border-border">
        <span className="text-xs font-medium text-text-primary">AI Rename</span>
        <div className="flex gap-1">
          <button
            onClick={toggle}
            className="text-text-muted hover:text-text-primary text-sm px-1"
            title="Minimize"
          >
            &#8722;
          </button>
          {aiTask.status !== 'running' && (
            <button
              onClick={dismiss}
              className="text-text-muted hover:text-text-primary text-sm px-1"
              title="Close"
            >
              &#10005;
            </button>
          )}
        </div>
      </div>
      <div className="px-3 py-3">
        <div className="text-xs text-text-muted truncate mb-2">
          {aiTask.sessionTitle || aiTask.sessionId.slice(0, 8)}
        </div>
        {aiTask.status === 'running' && (
          <div className="flex items-center gap-2">
            <span className="inline-block w-3 h-3 border-2 border-accent border-t-transparent rounded-full animate-spin" />
            <span className="text-xs text-accent">Generating title...</span>
          </div>
        )}
        {aiTask.status === 'done' && (
          <div className="text-sm text-success">
            &#10003; {aiTask.result}
          </div>
        )}
        {aiTask.status === 'error' && (
          <div className="text-xs text-danger">
            Failed: {aiTask.error}
          </div>
        )}
      </div>
    </div>
  );
}
