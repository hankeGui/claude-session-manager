export interface Project {
  dirName: string;
  displayName: string;
  projectPath: string;
  sessions: Session[];
}

export interface Session {
  sessionId: string;
  dirName: string;
  customTitle: string | null;
  summary: string | null;
  firstPrompt: string | null;
  messageCount: number;
  created: string;
  modified: string;
  gitBranch: string | null;
  diskSize: number;
  isEmpty: boolean;
  emptyReason: string | null;
  isFavorite: boolean;
}

export interface ToolCall {
  name: string;
  input?: Record<string, any>;
}

export interface SessionMessage {
  type: 'user' | 'assistant';
  content: string;
  timestamp: string;
  toolCalls?: ToolCall[];
}

export interface ScannerData {
  projects: Project[];
}

// Scheduler types
export type TaskStatus = 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';

export interface ScheduledTask {
  id: string;
  prompt: string;
  scheduleType: 'immediate' | 'once' | 'cron';
  scheduledAt: string | null;     // ISO for once
  cron: string | null;            // cron expression for recurring
  createdAt: string;
  startedAt: string | null;
  completedAt: string | null;
  status: TaskStatus;
  skipPermissions: boolean;
  openInTerminal: boolean;
  workingDirectory: string | null;
  model: string | null;
  output: string | null;
  error: string | null;
  lastRunAt: string | null;       // for cron tasks
  runCount: number;               // how many times cron has run
  runHistory: string[];           // last 10 run timestamps
  tmuxSession: string | null;     // tmux session name if running in tmux
}

