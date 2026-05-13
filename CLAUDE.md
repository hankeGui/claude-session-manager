# Claude Session Manager — Development Guide

## Quick Reference

```bash
# Start server (production mode, serves built frontend)
npm start

# Dev mode (hot reload frontend)
# Terminal 1: PORT=3456 npm start
# Terminal 2: npm run dev

# Build frontend
npm run build

# Run all tests
npm test

# Type check
npm run typecheck
```

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────┐
│  CLI (bin/cli.js)                                               │
│  - Port detection, instance dedup, browser open                 │
└────────────────────────────┬────────────────────────────────────┘
                             │ spawns tsx server.ts
┌────────────────────────────▼────────────────────────────────────┐
│  Express Server (server.ts)                                     │
│  - Mounts API routes + serves dist/ static files                │
│  - Starts background AI scanner on boot                         │
└────────────────────────────┬────────────────────────────────────┘
                             │
         ┌───────────────────┼───────────────────┐
         │                   │                   │
┌────────▼───────┐ ┌────────▼───────┐ ┌────────▼───────┐
│   Routes       │ │   Services     │ │  Frontend      │
│ (API handlers) │ │ (business)     │ │ (React SPA)    │
└────────────────┘ └────────────────┘ └────────────────┘
```

## Data Flow

```
~/.claude/projects/
├── <dirName>/                    # One per project (hashed path)
│   ├── sessions-index.json       # Quick metadata (if available)
│   └── <sessionId>.jsonl         # Full message log
```

**On startup:**
1. `scanner.scan()` — reads all projects/sessions, builds in-memory index
2. `scanner.extractMetaTags()` — tags sessions with project dir + git branch
3. `aiScanner.start()` — background: extracts PR/Jira refs → generates AI summaries → auto-renames untitled sessions

**Persistence files (project root):**
| File | Purpose |
|------|---------|
| `session-titles.json` | Custom session titles |
| `session-favorites.json` | Favorite flags |
| `session-tags.json` | Tags with source tracking |
| `session-ai-summaries.json` | AI-generated summaries |
| `scheduled-tasks.json` | Cron scheduler tasks |
| `user-preferences.json` | Terminal prefs + AI config |

## Services

### scanner.ts — Core data layer
- Scans `~/.claude/projects/`, builds `ScannerData` in memory
- Manages titles, favorites, tags (CRUD + persistence)
- **Tag system**: each session has `{ tags: string[], sources: string[] }`
  - Sources: `"meta"` (path/branch), `"refs"` (PR/Jira), `"search"` (AI deep search)
  - `hasTagSource(id, source)` prevents re-extraction
  - `addTags(id, tags[], source)` — batch add + mark source + persist

### ai-scanner.ts — Background processing
- Runs after startup, non-blocking
- Phase 1 (`refs`): extract PR/Jira ref tags (pure I/O, fast)
- Phase 2 (`summary`): generate AI summaries for uncached sessions (concurrency 3)
- Phase 3 (`rename`): auto-rename sessions without customTitle using `generateTitle()`
- **Active session filtering**: sessions modified within last 2 minutes are skipped (actively in use)
- **Controls**: `pause()`/`resume()`/`stop()` — stop cancels both phases (rename skipped if cancelled)
- Status: `{ running, paused, cancelled, phase: 'idle'|'summary'|'rename', total, done, cached }`
- Frontend polls `/api/ai-scan/status` every 2s, shows progress widget with pause/resume/cancel buttons
- **Re-extract flow**: `/api/rescan` only scans + returns pending counts (does NOT auto-start AI); frontend shows confirmation dialog with estimated API calls before calling `/api/ai-scan/start`

### ai-client.ts — Anthropic SDK wrapper
- Config priority: env vars > `~/.claude/settings.json` > `user-preferences.json`
- Two auth modes: API key or auth token (custom header)
- `askAi(prompt, opts)` — single call with 30s timeout

### session-reader.ts — JSONL parser
- Reads session message files, extracts user/assistant turns
- Strips system tags, handles tool use blocks
- Extracts tool inputs for Skill/Agent/LSP/WebFetch/WebSearch (shown as inline tags)
- **Noise filtering**: `isNoiseMessage()` detects slash commands (/exit, /clear, /quit), "Bye!", "No response requested."
  - Filtered by default; pass `includeNoise: true` to include all
  - Assistant messages with `toolCalls` are never filtered (only empty text-only messages)
  - Returns `totalUnfiltered` count for frontend toggle detection

### scheduler.ts — Cron task engine
- node-cron based, persists to JSON
- AI natural language → cron expression conversion
- tmux integration for long-running tasks

## Routes

| Route file | Prefix | Key endpoints |
|-----------|--------|---------------|
| projects.ts | `/api/projects` | List projects, get sessions |
| sessions.ts | `/api/sessions` | Messages, delete, rename, resume (tmux/osascript), favorites |
| search.ts | `/api/search` | Fuzzy/regex search, AI deep search |
| scheduler.ts | `/api/scheduler` | Task CRUD, run, generate-cron |
| settings.ts | `/api/settings` | AI config |
| server.ts (inline) | `/api/ai-scan` | `GET /status`, `POST /pause`, `POST /resume`, `POST /stop`, `POST /start` |
| server.ts (inline) | `/api/rescan` | Re-scan files only (returns pending counts, no AI start) |

## Frontend (client/)

- **React 18 + TypeScript + Tailwind CSS** (Vite)
- **State**: Zustand store (`store/index.ts`) — sessions, AI scan polling, batch rename SSE
- **Key components**:
  - `SessionCard` — search highlight, score badge, matched field display
  - `SessionModal` — message view with timestamps, fold/unfold, noise toggle, tool/skill/agent tags
  - `ResumeDialog` — terminal selector, tmux checkbox, custom command builder, CLI flag reference
  - `AiScanProgress` — fixed bottom-right widget showing background scan phase + progress
  - `BatchRenameIndicator` — SSE-driven progress for batch AI rename
- **Build output**: `../dist/` (served by Express in production)

## Tag System Design

Tags auto-extracted at different stages:

| Source | When | What | AI needed |
|--------|------|------|-----------|
| `meta` | scan() sync | project dir name, git branch | No |
| `refs` | aiScanner.start() | PR#numbers, JIRA-tickets from messages | No (regex) |
| `search` | deep search POST | search keyword applied to matched sessions | Yes |

Anti-duplicate: each source is tracked per-session in `session-tags.json`. A session tagged by search won't skip `meta` or `refs` extraction.

## Search Scoring

Weighted per-field scoring with matched field tracking:

| Match type | Score | Details |
|-----------|-------|---------|
| Exact tag / PR# | 200 | Case-insensitive exact match on any tag |
| Title includes | 50 | `customTitle` contains query |
| Summary includes | 30 | AI-generated summary contains query |
| First prompt includes | 20 | First user message contains query |
| Branch includes | 15 | Git branch name contains query |
| Tag partial includes | 20 | Tag contains query (not exact) |
| Session ID includes | 5 | UUID contains query |
| Fuzzy match | variable | Must pass threshold: `score >= query.length * 2` |

Multiple field matches accumulate (e.g., title+summary = 80). Results include `_searchScore` and `_matchedFields` for frontend display.

## Resume Session (tmux integration)

The resume endpoint (`POST /api/sessions/:id/resume`) supports two modes:

**osascript mode** (default): Opens iTerm2 or Terminal.app via AppleScript with the `claude --resume` command.

**tmux mode** (`terminal: 'tmux'`):
1. Creates a background tmux session: `tmux new-session -d -s resume-<id8>`
2. Sends the claude command with `; exit` suffix (auto-cleanup on exit)
3. Opens user's preferred terminal with `tmux attach -t <name>`
4. If session already exists (`has-session`), skips creation and just opens attach

Key behaviors:
- tmux session auto-destroys when claude exits (via `; exit` appended to command)
- Same session ID always maps to same tmux name → no duplicates
- `terminalApp` body param controls which terminal opens for attach (iTerm/Terminal.app)
- Frontend shows the exact command that will run; Copy and Execute are identical

## Publishing

```bash
# 1. Bump version
npm version patch  # or minor

# 2. Push
git push && git push --tags

# 3. Create release (triggers GitHub Actions → npm publish)
gh release create v<version> --title "v<version>" --generate-notes
```

Manual fallback: `cd client && npm i && npm run build && cd .. && npm publish --access public`

## Conventions

- Small version bumps (patch/minor) only; publish only when explicitly asked
- AI features degrade gracefully — if no API key configured, they're skipped
- All metadata cleaned up on session delete (titles, favorites, tags, summaries)
- Background tasks use pause/resume pattern to avoid API overload conflicts
- SSE streams check `res.destroyed || res.writableEnded` before writing
- Express routes use `res.on('close')` (not `req.on('close')`) for client disconnect
