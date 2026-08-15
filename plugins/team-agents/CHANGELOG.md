# Changelog

All notable changes to `team-agents`. Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

`version` is deliberately omitted from `plugin.json` and `marketplace.json` during
the internal phase — Claude Code resolves the version from the source's git commit
SHA, so teammates tracking `main` get updates on every push. Entries below are
therefore keyed by phase, not by version number, until the first stable release.

## [Unreleased] — Phase 0: skeleton that loads

### Added
- Marketplace manifest (`.claude-plugin/marketplace.json`) and plugin manifest
  (`plugins/team-agents/.claude-plugin/plugin.json`).
- Hook wiring: `hooks/hooks.json` (standard profile) and `hooks/strict.hooks.json`,
  plus `scripts/hooks/session-start.js` proving `${CLAUDE_PLUGIN_ROOT}` resolution.
- The `scripts/lib/` seam: `hook-io.js`, `config.js`, `changeset.js`, `eventlog.js`.
- Schemas (`schemas/`), policies (`policies/`), install profiles (`manifests/`).
- `bin/` command stubs: `arc-usage`, `arc-context`, `arc-lint`.
- CI suite under `scripts/ci/` and hook-event fixtures under `tests/fixtures/`.

### Not yet present
No skills and no agents ship yet — `skills/`, `agents/`, and `domains/backend/`
are wired into the manifest but empty. See `docs/BUILD-PLAN.md` phases 3 and 4.
