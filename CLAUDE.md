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
3. `aiScanner.start()` — background: extracts PR/Jira refs, then generates AI summaries

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
- Phase 1: extract PR/Jira ref tags (pure I/O, fast)
- Phase 2: generate AI summaries for uncached sessions (concurrency 3)
- `pause()`/`resume()` coordination with user-initiated batch rename

### ai-client.ts — Anthropic SDK wrapper
- Config priority: env vars > `~/.claude/settings.json` > `user-preferences.json`
- Two auth modes: API key or auth token (custom header)
- `askAi(prompt, opts)` — single call with 30s timeout

### session-reader.ts — JSONL parser
- Reads session message files, extracts user/assistant turns
- Strips system tags, handles tool use blocks

### scheduler.ts — Cron task engine
- node-cron based, persists to JSON
- AI natural language → cron expression conversion
- tmux integration for long-running tasks

## Routes

| Route file | Prefix | Key endpoints |
|-----------|--------|---------------|
| projects.ts | `/api/projects` | List projects, get sessions |
| sessions.ts | `/api/sessions` | Messages, delete, rename, resume, favorites |
| search.ts | `/api/search` | Fuzzy/regex search, AI deep search |
| scheduler.ts | `/api/scheduler` | Task CRUD, run, generate-cron |
| settings.ts | `/api/settings` | AI config |

## Frontend (client/)

- **React 18 + TypeScript + Tailwind CSS** (Vite)
- **State**: Zustand store (`store/index.ts`)
- **Components**: SessionList, SessionCard, SessionModal, Header, Sidebar, SearchBar
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

- Exact tag match / PR# number match → score 200 (top priority)
- Field includes query → score 100
- Fuzzy match → variable score < 100

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
