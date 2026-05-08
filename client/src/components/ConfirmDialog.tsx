import { useState, useCallback, useEffect } from 'react';

interface ConfirmOptions {
  title?: string;
  message: string;
  html?: boolean;
  okText?: string;
  okClass?: string;
  checkbox?: { label: string; defaultChecked?: boolean };
  onMount?: (close: () => void) => void;
}

interface ConfirmState extends ConfirmOptions {
  resolve: (result: { confirmed: boolean; checked?: boolean }) => void;
}

let showConfirmFn: ((opts: ConfirmOptions) => Promise<{ confirmed: boolean; checked?: boolean }>) | null = null;

export function confirm(opts: ConfirmOptions): Promise<{ confirmed: boolean; checked?: boolean }> {
  return showConfirmFn?.(opts) ?? Promise.resolve({ confirmed: false });
}

export default function ConfirmDialog() {
  const [state, setState] = useState<ConfirmState | null>(null);
  const [checked, setChecked] = useState(false);

  const show = useCallback((opts: ConfirmOptions) => {
    return new Promise<{ confirmed: boolean; checked?: boolean }>((resolve) => {
      setChecked(opts.checkbox?.defaultChecked ?? false);
      setState({ ...opts, resolve });
    });
  }, []);

  useEffect(() => {
    showConfirmFn = show;
    return () => { showConfirmFn = null; };
  }, [show]);

  useEffect(() => {
    if (!state) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        state.resolve({ confirmed: false });
        setState(null);
      }
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [state]);

  useEffect(() => {
    if (state?.onMount) {
      const close = () => { state.resolve({ confirmed: false }); setState(null); };
      setTimeout(() => state.onMount!(close), 0);
    }
  }, [state]);

  if (!state) return null;

  return (
    <div
      className="fixed inset-0 bg-black/70 flex items-center justify-center z-[200]"
      onClick={() => { state.resolve({ confirmed: false }); setState(null); }}
    >
      <div
        className="bg-bg-secondary border border-border rounded-lg p-6 max-w-[400px] w-full"
        onClick={(e) => e.stopPropagation()}
      >
        {state.title && (
          <h3 className="text-center font-semibold mb-3">{state.title}</h3>
        )}
        <div className="mb-5 text-sm text-left">
          {state.html ? (
            <div dangerouslySetInnerHTML={{ __html: state.message }} />
          ) : (
            <p>{state.message}</p>
          )}
        </div>
        {state.checkbox && (
          <label className="flex items-center gap-2 text-xs text-warning cursor-pointer mb-4">
            <input
              type="checkbox"
              checked={checked}
              onChange={(e) => setChecked(e.target.checked)}
              className="cursor-pointer"
            />
            {state.checkbox.label}
          </label>
        )}
        <div className="flex gap-3 justify-center">
          <button
            className="px-4 py-2 border border-border rounded-md bg-bg-card text-text-primary text-sm hover:bg-border"
            onClick={() => { state.resolve({ confirmed: false }); setState(null); }}
          >
            Cancel
          </button>
          <button
            className={`px-4 py-2 border rounded-md text-sm font-medium ${
              state.okClass === 'success'
                ? 'border-success text-success hover:bg-success hover:text-black'
                : 'border-danger text-danger hover:bg-danger hover:text-white'
            }`}
            onClick={() => { state.resolve({ confirmed: true, checked }); setState(null); }}
          >
            {state.okText || 'Confirm'}
          </button>
        </div>
      </div>
    </div>
  );
}
