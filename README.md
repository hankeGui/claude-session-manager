# Claude Session Manager

A local web UI for managing [Claude Code](https://docs.anthropic.com/en/docs/claude-code) sessions across all your projects.

As you work with Claude Code across many projects, sessions accumulate quickly and become hard to find. Some are cleared, some are abandoned, and finding the right one to resume becomes painful. This tool solves that.

## Features

- **Browse all sessions** grouped by project, with message count, branch, dates, and disk size
- **Favorites** — star sessions, dedicated Favorites folder in sidebar, persistent across restarts
- **Search** — weighted scoring (title 50, summary 30, prompt 20, branch 15, tag 20), regex mode, score display with matched field highlighting
- **AI Deep Search** — semantic search via Anthropic API, auto-tags matched sessions for instant future lookup
- **Auto-tagging** — sessions are auto-tagged with project name, git branch, PR numbers, and Jira tickets
- **Sort** by modified time, created time, message count, or context size
- **View session messages** — clean formatting with timestamps, collapsible messages, tool/skill/agent tags, noise filtering
- **Resume sessions** — terminal selector (iTerm2/Terminal.app), tmux support (background session + auto-attach), skip-permissions option, custom command builder with CLI flag reference
- **AI Rename** — single or batch rename with streaming progress, pre-check for already-named sessions
- **Background AI scan** — generates summaries then auto-renames untitled sessions, right-corner progress widget
- **Scheduler** — cron tasks with AI natural language parsing, tmux session management, live output
- **Delete sessions** — single or batch delete with confirmation, cleans up all related metadata
- **Empty detection** — flags cleared/abandoned sessions (//clear, //exit, Goodbye, no conversation)
- **Noise filtering** — hides slash commands (/exit, /clear), "Bye!", "No response requested." from message view with opt-in toggle
- **Auto port detection** — finds a free port automatically if default 3000 is in use
- **Instance deduplication** — prevents multiple server instances from running simultaneously
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
├── bin/cli.js              # CLI entry (port detect, instance dedup, browser open)
├── server.ts               # Express server (API + static + AI scan boot)
├── CLAUDE.md               # Development guide and architecture docs
├── src/
│   ├── routes/             # API route handlers
│   │   ├── projects.ts     # Project listing and session fetching
│   │   ├── sessions.ts     # Messages, delete, rename, resume, batch rename (SSE)
│   │   ├── search.ts       # Fuzzy/regex search + AI deep search
│   │   ├── scheduler.ts    # Cron task management
│   │   └── settings.ts     # AI config and preferences
│   ├── services/           # Business logic
│   │   ├── scanner.ts      # Session indexing, metadata, tag system
│   │   ├── session-reader.ts   # JSONL message parsing
│   │   ├── session-cleaner.ts  # Session deletion + cleanup
│   │   ├── ai-scanner.ts   # Background AI summary + ref tag extraction
│   │   ├── ai-client.ts    # Anthropic SDK wrapper (askAi)
│   │   ├── scheduler.ts    # node-cron task engine
│   │   └── tmux.ts         # tmux session management
│   ├── utils/paths.ts      # Path constants and helpers
│   └── types.ts            # Shared TypeScript interfaces
├── client/                 # React frontend source
│   ├── src/
│   │   ├── components/     # React components (18 files)
│   │   ├── store/          # Zustand state management
│   │   ├── api/            # API client
│   │   └── utils/          # Content cleaning utilities
│   └── vite.config.ts      # Builds to ../dist/
├── dist/                   # Built frontend (served in production)
├── tests/                  # Backend tests (Vitest + supertest)
└── .github/workflows/      # CI/CD (npm publish on release)
```

## AI Configuration

AI features (deep search, auto-rename, background scan) use the Anthropic SDK directly. Configuration priority:

1. Environment variables: `ANTHROPIC_BASE_URL`, `ANTHROPIC_API_KEY`, `ANTHROPIC_AUTH_TOKEN`, `ANTHROPIC_MODEL`, `ANTHROPIC_SMALL_FAST_MODEL`
2. `~/.claude/settings.json` → `env` section
3. `user-preferences.json` → `ai` section (editable via Settings UI)

At least one auth method (API key or auth token) is required for AI features. Without it, they gracefully degrade — all non-AI features work normally.

## API Reference

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/stats` | Dashboard overview (counts, dates) |
| GET | `/api/projects` | List all projects with session counts |
| GET | `/api/projects/:dirName/sessions` | List sessions for a project |
| GET | `/api/sessions/:sessionId/messages` | View session messages (paginated, noise=1 to include all) |
| GET | `/api/search?q=&project=&empty=&mode=&favorite=` | Search sessions (fuzzy/regex) |
| POST | `/api/search/deep` | AI semantic search (auto-tags results) |
| DELETE | `/api/sessions/:sessionId` | Delete a session |
| POST | `/api/sessions/batch-delete` | Batch delete sessions |
| PUT | `/api/sessions/:sessionId/title` | Set custom title |
| PUT | `/api/sessions/:sessionId/favorite` | Toggle favorite |
| POST | `/api/sessions/:sessionId/auto-rename` | AI auto-rename single session |
| POST | `/api/sessions/:sessionId/regenerate-summary` | Regenerate AI summary |
| POST | `/api/sessions/batch-rename` | Batch AI rename (SSE stream) |
| POST | `/api/sessions/:sessionId/resume` | Open terminal and resume (supports tmux mode) |
| GET | `/api/sessions/preferences` | Get terminal preferences |
| PUT | `/api/sessions/preferences` | Set terminal preferences |
| GET | `/api/settings/ai` | Get AI configuration status |
| PUT | `/api/settings/ai` | Update AI configuration |
| GET | `/api/ai-scan/status` | Background scan progress |
| GET | `/api/scheduler/tasks` | List scheduled tasks |
| POST | `/api/scheduler/tasks` | Create a scheduled task |
| DELETE | `/api/scheduler/tasks/:id` | Delete a task |
| POST | `/api/scheduler/tasks/:id/run` | Run task immediately |
| POST | `/api/scheduler/generate-cron` | AI: natural language to cron |
| GET | `/api/scheduler/capabilities` | Check tmux availability |

## Publishing / Release

Releases are automated via GitHub Actions. To publish a new version to npm:

```bash
# 1. Bump version in package.json
npm version patch   # or minor / major

# 2. Push commit and tag
git push && git push --tags

# 3. Create a GitHub Release (triggers CI → npm publish)
gh release create v<version> --title "v<version>" --generate-notes
```

The workflow (`.github/workflows/publish.yml`) will:
1. Checkout the tagged commit
2. Install client dependencies and build the frontend
3. Publish to npm with provenance

**Prerequisites:**
- `NPM_TOKEN` secret configured in GitHub repo settings (Settings > Secrets > Actions)
- The token needs `publish` permission on the npm package

**Manual publish (fallback):**
```bash
npm login
cd client && npm install && npm run build && cd ..
npm publish --access public
```

## Tech Stack

- **Frontend**: React 18 + TypeScript + Tailwind CSS (Vite 5)
- **State Management**: Zustand
- **Backend**: TypeScript + Express (runs via [tsx](https://github.com/privatenumber/tsx), no compile step)
- **AI**: Anthropic SDK (`@anthropic-ai/sdk`) — direct API calls, no CLI subprocess
- **Testing**: Vitest + supertest + @testing-library/react
- **CI/CD**: GitHub Actions for automated npm publishing on release

## Requirements

- Node.js 18+
- macOS (terminal integration uses AppleScript for iTerm2/Terminal.app)
- Claude Code CLI installed (for session data in `~/.claude/projects/`)
- Anthropic API key or auth token (optional, for AI features)
- tmux (optional, for scheduler tasks and session resume with detach/reattach support)

## License

MIT
