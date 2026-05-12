import { create } from 'zustand';
import { schedulerApi, ScheduledTask, CreateTaskPayload } from '../api/scheduler';

interface SchedulerState {
  tasks: ScheduledTask[];
  loading: boolean;
  showForm: boolean;
  editingTask: ScheduledTask | null;

  loadTasks: () => Promise<void>;
  createTask: (payload: CreateTaskPayload) => Promise<void>;
  updateTask: (id: string, payload: Partial<CreateTaskPayload>) => Promise<void>;
  deleteTask: (id: string) => Promise<void>;
  runNow: (id: string) => Promise<void>;
  cancelTask: (id: string) => Promise<void>;
  setShowForm: (show: boolean) => void;
  setEditingTask: (task: ScheduledTask | null) => void;
}

export const useSchedulerStore = create<SchedulerState>((set, get) => ({
  tasks: [],
  loading: false,
  showForm: false,
  editingTask: null,

  loadTasks: async () => {
    const { tasks } = await schedulerApi.getTasks();
    set({ tasks });
  },

  createTask: async (payload) => {
    await schedulerApi.createTask(payload);
    set({ showForm: false });
    get().loadTasks();
  },

  updateTask: async (id, payload) => {
    await schedulerApi.updateTask(id, payload);
    set({ showForm: false, editingTask: null });
    get().loadTasks();
  },

  deleteTask: async (id) => {
    await schedulerApi.deleteTask(id);
    get().loadTasks();
  },

  runNow: async (id) => {
    await schedulerApi.runNow(id);
    get().loadTasks();
  },

  cancelTask: async (id) => {
    await schedulerApi.cancelTask(id);
    get().loadTasks();
  },

  setShowForm: (show) => set({ showForm: show, editingTask: show ? get().editingTask : null }),
  setEditingTask: (task) => set({ editingTask: task, showForm: !!task }),
}));
