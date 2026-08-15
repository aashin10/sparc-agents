# Changelog

All notable changes to `team-agents`. Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

`version` is deliberately omitted from `plugin.json` and `marketplace.json` during
the internal phase — Claude Code resolves the version from the source's git commit
SHA, so teammates tracking `main` get updates on every push. Entries below are
therefore keyed by phase, not by version number, until the first stable release.

## [Unreleased] — Phase 1: the seam and the first real guardrails

### Added
- `scripts/lib/classify.js` — path to `{domain, layer, project, isTest,
  isMigration, isController, isGenerated}`. Pure string work so it fits inside
  the PreToolUse budget.
- `scripts/lib/dotnet.js` — solution/project graph. Answers "which projects own
  these files" and "which tests cover those projects", walking ProjectReference
  edges transitively. Cached under `${CLAUDE_PLUGIN_DATA}`, invalidated on any
  `.csproj` change.
- `pre:config-protection` (PreToolUse) — blocks edits to `.editorconfig`,
  `Directory.Build.props`/`.targets`, `Directory.Packages.props`, `*.ruleset`,
  and `.globalconfig`, with guidance to fix the code or suppress narrowly.
- `post:edit-accumulate` (PostToolUse) — records touched files into the turn's
  changeset, skipping generated output. Runs no tooling.
- `stop:quality-gate` (Stop) — scoped `dotnet format` and `dotnet build` against
  only the touched projects; adds `dotnet test` under the strict profile.
  Advisory on standard, blocking on strict.
- Fixtures for the `.editorconfig` and generated-file cases.

### Changed
- `hooks/hooks.json` now registers all four hooks.
- `SCHEMA-NOTES.md` records manifest behaviour verified against CLI v2.1.233,
  including two items that contradict ARCHITECTURE §5.1 as written.

### Known limits
- The Stop gate is bounded to an 8,000 ms budget over at most 4 projects, and
  reports explicitly when it drops work rather than passing silently. On this
  machine one project's format+build costs ~5.5 s, so the caps will bind on a
  real solution — tune them against the actual target before relying on it.
- `hooks/strict.hooks.json` is not yet wired up; profile switching is runtime,
  not file-based. See SCHEMA-NOTES.

## Phase 0 — skeleton that loads

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
