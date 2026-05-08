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
- **Rename sessions** — manual or AI-powered auto-rename with background progress indicator
- **Empty detection** — automatically flags cleared/abandoned sessions with reason (No conversation, Exited immediately, Cleared, etc.)
- **Auto port detection** — finds a free port automatically if default 3000 is in use
- **Dark theme** — easy on the eyes

## Quick Start

```bash
# Run directly (no install needed)
npx claude-session-mgr

# Or install globally
npm install -g claude-session-mgr
csm
```

Stop the server with `Ctrl+C`.

## Development

```bash
git clone https://github.com/hankeGui/claude-session-manager.git
cd claude-session-manager
npm install

# Start the backend (serves built frontend)
npm start

# Start Vite dev server with hot reload (proxies API to backend)
# Terminal 1: PORT=3456 npm start
# Terminal 2: npm run dev
```

Open http://localhost:5173 (dev) or http://localhost:3000 (production) in your browser.

## Testing

```bash
# Run all tests (backend + frontend)
npm test

# Backend tests only
npm run test:backend

# Frontend tests only
npm run test:client
```

Tests use [Vitest](https://vitest.dev/) with:
- Backend: supertest for API integration tests
- Frontend: @testing-library/react for component/store tests

## How It Works

The app reads session data directly from `~/.claude/projects/` on your local machine:

- `sessions-index.json` — session metadata (when available)
- `*.jsonl` — full session message logs (scanned for unindexed sessions)
- `file-history/` and subagent directories — cleaned up on delete

No database required. All data stays local.

## Project Structure

```
claude-session-mgr/
├── bin/cli.js              # CLI entry point (auto port, browser open)
├── server.ts               # Express server (API + static serving)
├── src/
│   ├── routes/             # API route handlers
│   │   ├── projects.ts     # Project listing and session fetching
│   │   ├── sessions.ts     # Messages, delete, rename, resume
│   │   └── search.ts       # Local search and AI deep search
│   ├── services/           # Business logic
│   │   ├── scanner.ts      # Session indexing and metadata
│   │   ├── session-reader.ts   # JSONL message parsing
│   │   └── session-cleaner.ts  # Session deletion
│   ├── utils/paths.ts      # Path constants and helpers
│   └── types.ts            # Shared TypeScript interfaces
├── client/                 # React frontend source (dev only)
│   ├── src/
│   │   ├── components/     # React components
│   │   ├── store/          # Zustand state management
│   │   ├── api/            # API client
│   │   └── utils/          # Content cleaning utilities
│   └── vite.config.ts      # Builds to ../dist/
├── dist/                   # Built frontend (served in production)
├── tests/                  # Backend tests
└── vitest.config.ts        # Backend test configuration
```

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

- **Frontend**: React 18 + TypeScript + Tailwind CSS (Vite 5)
- **State Management**: Zustand
- **Backend**: TypeScript + Express (runs via [tsx](https://github.com/privatenumber/tsx), no compile step)
- **Testing**: Vitest + supertest + @testing-library/react
- **AI features**: Claude Code CLI (`claude -p`) for auto-rename and deep search
- **CI/CD**: GitHub Actions for automated npm publishing

## Requirements

- Node.js 18+
- Claude Code CLI installed and configured (for AI features)
- macOS (terminal integration uses AppleScript for iTerm2/Terminal.app)

## License

MIT
