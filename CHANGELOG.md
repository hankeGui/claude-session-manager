## <small>1.4.4 (2026-05-21)</small>




## <small>1.4.3 (2026-05-21)</small>

* docs: clarify publishing flow — GitHub Actions handles npm publish ([c0d1e5d](https://github.com/hankeGui/claude-session-manager/commit/c0d1e5d))



## <small>1.4.2 (2026-05-14)</small>

* fix: security hardening — XSS, shell injection, race conditions, rate limiting ([a8e4e19](https://github.com/hankeGui/claude-session-manager/commit/a8e4e19))
* fix: TypeScript errors, rate limit retry, poll dedup, batch-rename safety ([821bf4d](https://github.com/hankeGui/claude-session-manager/commit/821bf4d))



## <small>1.4.1 (2026-05-13)</small>

* feat: AI scan controls, smart re-extract confirmation, scheduler, resume improvements ([e1d7041](https://github.com/hankeGui/claude-session-manager/commit/e1d7041))



## 1.4.0 (2026-05-13)

* feat: tag system refactor, search boost, tests, docs ([04b7c42](https://github.com/hankeGui/claude-session-manager/commit/04b7c42))



## <small>1.3.2 (2026-05-13)</small>

* fix: batch rename concurrency 3 with realtime progress ([d913ff9](https://github.com/hankeGui/claude-session-manager/commit/d913ff9))



## <small>1.3.1 (2026-05-13)</small>

* feat: direct Anthropic API, background AI scan, auto-tagging ([a7e89cf](https://github.com/hankeGui/claude-session-manager/commit/a7e89cf))



## 1.3.0 (2026-05-13)

* bump to 1.3.0 ([3944bdb](https://github.com/hankeGui/claude-session-manager/commit/3944bdb))
* feat: wait for server before opening browser, add batch AI rename ([08f7f9d](https://github.com/hankeGui/claude-session-manager/commit/08f7f9d))
* docs: update README with publishing workflow, new features and API endpoints ([ea666ac](https://github.com/hankeGui/claude-session-manager/commit/ea666ac))



## 1.2.0 (2026-05-12)

* fix: remove unused ref attributes in ResumeDialog (TS error) ([ef8b639](https://github.com/hankeGui/claude-session-manager/commit/ef8b639))
* feat: add test suite (72 tests) and update documentation ([166e0d6](https://github.com/hankeGui/claude-session-manager/commit/166e0d6))
* feat: show empty reason next to Empty badge on session cards ([cbd5e39](https://github.com/hankeGui/claude-session-manager/commit/cbd5e39))
* feat: v1.2.0 — favorites, scheduler, tmux, search, resume dialog ([f1563ce](https://github.com/hankeGui/claude-session-manager/commit/f1563ce))



## <small>1.0.6 (2026-05-08)</small>

* bump to 1.0.6 ([67734bd](https://github.com/hankeGui/claude-session-manager/commit/67734bd))
* fix: auto-close rename dialog when AI Generate is clicked ([d443de8](https://github.com/hankeGui/claude-session-manager/commit/d443de8))
* feat: AI rename with progress indicator, minimize, single task lock ([5b145d3](https://github.com/hankeGui/claude-session-manager/commit/5b145d3))



## <small>1.0.5 (2026-05-08)</small>

* bump to 1.0.5 ([b1aebef](https://github.com/hankeGui/claude-session-manager/commit/b1aebef))
* fix: redirect stdin for claude -p in auto-rename ([e669c8a](https://github.com/hankeGui/claude-session-manager/commit/e669c8a))



## <small>1.0.4 (2026-05-08)</small>

* bump to 1.0.4 ([5fdb3a4](https://github.com/hankeGui/claude-session-manager/commit/5fdb3a4))
* feat: auto-detect free port when default is in use ([5a6d8d5](https://github.com/hankeGui/claude-session-manager/commit/5a6d8d5))



## <small>1.0.3 (2026-05-08)</small>

* refactor: output build to root dist/, simplify npm packaging ([ee09ccd](https://github.com/hankeGui/claude-session-manager/commit/ee09ccd))



## <small>1.0.2 (2026-05-08)</small>

* fix: include client/dist in npm package, remove stale public/ fallback ([28b6e77](https://github.com/hankeGui/claude-session-manager/commit/28b6e77))



## <small>1.0.1 (2026-05-08)</small>

* fix: resolve tsx path for npx/hoisted installs, bump to 1.0.1 ([9950b43](https://github.com/hankeGui/claude-session-manager/commit/9950b43))



## 1.0.0 (2026-05-08)

* Add CLI entry point for npx and global install support ([4efc73f](https://github.com/hankeGui/claude-session-manager/commit/4efc73f))
* Add npm publish GitHub Action and fix CLI entry point ([7ca7c2d](https://github.com/hankeGui/claude-session-manager/commit/7ca7c2d))
* Convert entire project to TypeScript ([a92027b](https://github.com/hankeGui/claude-session-manager/commit/a92027b))
* Initial release: Claude Code session manager web UI ([f3f33f0](https://github.com/hankeGui/claude-session-manager/commit/f3f33f0))
* rename package to claude-session-mgr (original name taken) ([fbb3df5](https://github.com/hankeGui/claude-session-manager/commit/fbb3df5))
* Rewrite frontend with React + Vite + Tailwind CSS + TypeScript ([942d37d](https://github.com/hankeGui/claude-session-manager/commit/942d37d))



