# sparc-agents

Marketplace repo for `team-agents`, a Claude Code plugin. **This repo builds a
plugin; it is not itself a consumer of one.**

Full spec: `docs/ARCHITECTURE.md`. Task sequence: `docs/BUILD-PLAN.md`.
Read both before making structural changes.

## Layout

```
.claude-plugin/marketplace.json     # marketplace manifest
plugins/team-agents/                # the plugin root
scripts/ci/                         # validators for the plugin
tests/fixtures/hook-events/         # canned hook stdin payloads
docs/                               # spec and plan
```

## Naming

- Marketplace: `sparc-agents`. Plugin: `team-agents`. **Never rename either** —
  both are baked into every teammate's `enabledPlugins`.
- Skill and agent directory/file names must equal their frontmatter `name`.
- Domain components carry the domain in the name: `backend-<topic>`. The path
  is not enough; the frontmatter `name` is what gets invoked.
- Components resolve as `team-agents:<name>`.

## Where things go

Route every new component through this before writing it:

```
Can a script decide it without model judgment?     -> hook       (hooks/, scripts/hooks/)
Must the model know it every turn in a repo?       -> rule       (domains/*/rules/)
Must the model know it only sometimes?             -> skill      (skills/ or domains/*/skills/)
Needs its own context budget + tool allowlist?     -> agent      (agents/ or domains/*/agents/)
```

Core vs domain test: **would a frontend or data engineer also want this?**
Yes -> `skills/` or `agents/`. Mentions dotnet, EF Core, Service Bus, or SQL
Server -> `domains/backend/`.

If you actually care about a behaviour, it is a hook. Rules and skills are
context, not enforcement.

## Hard constraints

- Only `plugin.json` and `SCHEMA-NOTES.md` live in `.claude-plugin/`. Every
  other component directory sits at the plugin root.
- Agent frontmatter `tools` is a **comma-separated scalar**: `tools: Read, Grep, Glob`.
  Not a YAML sequence. `tools` is mandatory here — omitting it grants every tool.
- Reviewer agents are read-only. Write-capable agents declare `maxTurns`.
- Skill `description` must be an **inline scalar**, never a block scalar
  (`|`, `|-`, `>`). It must state what the skill does *and* when to use it.
- `SKILL.md` stays under 500 lines. Overflow goes to `references/`.
  Put the most important instructions at the **top** — after compaction, skill
  bodies are truncated from the end.
- `PreToolUse` hooks return in under 150 ms. Heavier work moves to `Stop`.
- Write state only to `${CLAUDE_PLUGIN_DATA}`. Never to `${CLAUDE_PLUGIN_ROOT}` —
  that path changes on every update.
- Manifest paths are relative and start with `./`.
- `skills` in the manifest **adds** to the default scan. `agents` **replaces** it,
  so both `./agents/` and `./domains/backend/agents/` must be listed.
- Every hook ships with a fixture in `tests/fixtures/hook-events/` in the same
  commit. No exceptions.

## Always-on token budget

Ceiling is **2,500 tokens**. Check after every content commit:

```bash
claude plugin details team-agents
```

If a change pushes it over, the fix is a shorter description or
`disable-model-invocation: true` — not raising the ceiling.

## Dev loop

```bash
claude --plugin-dir ./plugins/team-agents    # load without installing
/reload-plugins                              # after any non-SKILL.md edit
claude plugin validate ./plugins/team-agents --strict
claude --debug                               # loading errors, skipped components
node scripts/ci/smoke-hooks.js
```

`SKILL.md` edits apply immediately. Changes to `hooks/`, `agents/`, and
`settings.json` need `/reload-plugins`.

## Conventions

- Hooks are thin. Logic lives in `scripts/lib/`; a hook file should be ~30 lines.
- Prefer zero runtime dependencies. Node's stdlib covers what `lib/` needs, and
  a failed dependency install becomes a silent hook failure on someone else's
  machine.
- Ship `package-lock.json`. `yarn.lock` and `pnpm-lock.yaml` are skipped by the
  plugin cache installer.
- When the validator rejects something for a non-obvious reason, append it to
  `plugins/team-agents/.claude-plugin/SCHEMA-NOTES.md` immediately.

## Out of scope for now

Multi-plugin split, bundled MCP or LSP servers, monitors, themes, channels, a
second domain pack, any web dashboard, cross-harness adapters. See the deferred
list in `docs/BUILD-PLAN.md`.
