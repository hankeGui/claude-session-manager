import { useState, useRef, useEffect } from 'react';
import { useStore } from '../store';
import { showToast } from './Toast';

interface Props {
  sessionId: string;
  currentTitle: string;
  onClose: () => void;
  onSave: (title: string) => void;
}

export default function RenameDialog({ sessionId, currentTitle, onClose, onSave }: Props) {
  const [title, setTitle] = useState(currentTitle);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.select();
  }, []);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [onClose]);

  const handleAiGenerate = () => {
    const { aiTask, startAiRename } = useStore.getState();
    if (aiTask?.status === 'running') {
      showToast('AI task already running, please wait', 'error');
      return;
    }
    startAiRename(sessionId, currentTitle);
    onClose();
  };

  return (
    <div
      className="fixed inset-0 bg-black/70 flex items-center justify-center z-[200]"
      onClick={onClose}
    >
      <div
        className="bg-bg-secondary border border-border rounded-lg p-6 max-w-[500px] w-full"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="text-center font-semibold mb-3">Rename Session</h3>
        <div className="flex gap-2 items-center mb-5">
          <input
            ref={inputRef}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Enter new title..."
            className="flex-1 px-3 py-2 border border-border rounded-md bg-bg-card text-text-primary text-sm"
            onKeyDown={(e) => { if (e.key === 'Enter') onSave(title); }}
          />
          <button
            onClick={handleAiGenerate}
            className="px-3 py-1.5 border border-warning text-warning rounded-md text-xs hover:bg-warning hover:text-black whitespace-nowrap"
          >
            AI Generate
          </button>
        </div>
        <div className="flex gap-3 justify-center">
          <button
            onClick={onClose}
            className="px-4 py-2 border border-border rounded-md bg-bg-card text-text-primary text-sm hover:bg-border"
          >
            Cancel
          </button>
          <button
            onClick={() => onSave(title)}
            className="px-4 py-2 border border-success text-success rounded-md text-sm font-medium hover:bg-success hover:text-black"
          >
            Save
          </button>
        </div>
      </div>
    </div>
  );
}
