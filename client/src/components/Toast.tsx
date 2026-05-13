import { useEffect, useState, useCallback } from 'react';

type ToastType = 'success' | 'error' | 'warning' | 'info';

interface ToastItem {
  id: number;
  message: string;
  type: ToastType;
}

let toastId = 0;
let addToastFn: ((message: string, type: ToastType) => void) | null = null;

export function showToast(message: string, type: ToastType = 'info') {
  addToastFn?.(message, type);
}

const typeStyles: Record<ToastType, string> = {
  success: 'bg-success text-black',
  error: 'bg-danger text-white',
  warning: 'bg-warning text-black',
  info: 'bg-accent text-black',
};

export default function Toast() {
  const [toasts, setToasts] = useState<ToastItem[]>([]);

  const addToast = useCallback((message: string, type: ToastType) => {
    const id = ++toastId;
    setToasts((prev) => [...prev, { id, message, type }]);
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 3000);
  }, []);

  useEffect(() => {
    addToastFn = addToast;
    return () => { addToastFn = null; };
  }, [addToast]);

  return (
    <div className="fixed bottom-6 left-6 z-[300] flex flex-col gap-2">
      {toasts.map((t) => (
        <div
          key={t.id}
          className={`px-5 py-3 rounded-md text-sm max-w-[400px] animate-slide-up ${typeStyles[t.type]}`}
        >
          {t.message}
        </div>
      ))}
    </div>
  );
}
