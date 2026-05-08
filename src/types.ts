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
}

export interface SessionMessage {
  type: 'user' | 'assistant';
  content: string;
  timestamp: string;
  toolCalls?: string[];
}

export interface ScannerData {
  projects: Project[];
}
