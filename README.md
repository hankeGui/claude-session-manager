# Claude Session Manager

A local web UI for managing [Claude Code](https://docs.anthropic.com/en/docs/claude-code) sessions across all your projects.

As you work with Claude Code across many projects, sessions accumulate quickly and become hard to find. Some are cleared, some are abandoned, and finding the right one to resume becomes painful. This tool solves that.

## Features

- **Browse all sessions** grouped by project, with message count, branch, dates, and disk size
- **Search** across session summaries, prompts, branches, and custom titles
- **AI Deep Search** — when local search finds nothing, use Claude to semantically match sessions
- **Sort** by modified time, created time, message count, or context size
- **View session messages** — read conversation history with clean formatting (system tags stripped)
- **Resume sessions** — open a terminal and run `claude --resume <id>` with one click
- **Delete sessions** — single or batch delete with confirmation, cleans up all related files
- **Rename sessions** — manual or AI-powered auto-rename using Claude
- **Empty detection** — automatically flags cleared/abandoned sessions for cleanup
- **Dark theme** — easy on the eyes

## Quick Start

```bash
# Run directly (no install needed)
npx claude-session-manager

# Or install globally
npm install -g claude-session-manager
csm
```

## Development

```bash
git clone https://github.com/hankeGui/claude-session-manager.git
cd claude-session-manager
npm install

# Start the backend (serves built frontend)
npm start

# Start Vite dev server with hot reload (proxies API to backend)
# Run in one terminal: PORT=3456 npm start
# Run in another: npm run dev
```

Open http://localhost:5173 (dev) or http://localhost:3000 (production) in your browser.

## How It Works

The app reads session data directly from `~/.claude/projects/` on your local machine:

- `sessions-index.json` — session metadata (when available)
- `*.jsonl` — full session message logs (scanned for unindexed sessions)
- `file-history/` and subagent directories — cleaned up on delete

No database required. All data stays local.

## API Reference

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/projects` | List all projects with session counts |
| GET | `/api/projects/:dirName/sessions` | List sessions for a project |
| GET | `/api/sessions/:sessionId/messages` | View session messages |
| GET | `/api/search?q=&project=&branch=&empty=` | Search sessions |
| POST | `/api/search/deep` | AI-powered semantic search |
| GET | `/api/stats` | Dashboard overview |
| DELETE | `/api/sessions/:sessionId` | Delete a session |
| POST | `/api/sessions/batch-delete` | Batch delete sessions |
| PUT | `/api/sessions/:sessionId/title` | Set custom title |
| POST | `/api/sessions/:sessionId/auto-rename` | AI auto-rename |
| POST | `/api/sessions/:sessionId/resume` | Open terminal and resume |

## Tech Stack

- **Frontend**: React + TypeScript + Tailwind CSS (Vite 5)
- **State Management**: Zustand
- **Backend**: TypeScript + Express (runs via [tsx](https://github.com/privatenumber/tsx), no compile step)
- **AI features**: Claude Code CLI (`claude -p`) for auto-rename and deep search

## Requirements

- Node.js 18+
- Claude Code CLI installed and configured
- macOS (terminal integration uses AppleScript for iTerm2/Terminal.app)

## License

MIT
