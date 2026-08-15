# sparc-agents

Marketplace repo for **`team-agents`**, a Claude Code plugin.

This repo *builds* a plugin; it is not itself a consumer of one. Everything under
`plugins/team-agents/` is the shipped artifact. Everything outside it — CI,
fixtures, docs — exists to keep that artifact honest.

- **Spec:** [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) — what exists, where it lives, why.
- **Sequence:** [docs/BUILD-PLAN.md](docs/BUILD-PLAN.md) — ordered phases with acceptance criteria.
- **Conventions:** [CLAUDE.md](CLAUDE.md) — the rules enforced while building.

## Status

**Phase 0 — skeleton.** The framework is in place and loads. **No skills and no
agents ship yet.** `skills/`, `agents/`, and `domains/backend/` are wired into
the manifest but empty; they fill in during phases 3 and 4.

What works today: the manifests, the hook wiring, the `scripts/lib/` seam, one
proof-of-life `SessionStart` hook, and the full CI suite with fixtures.

## Layout

```
.claude-plugin/marketplace.json     marketplace manifest
plugins/team-agents/                the plugin root — the shipped artifact
scripts/ci/                         validators for the plugin, not for user code
tests/fixtures/hook-events/         canned hook stdin payloads
evals/                              golden transcripts (Phase 5)
docs/                               spec, plan, rollout
```

Inside the plugin:

```
.claude-plugin/     plugin.json and SCHEMA-NOTES.md — nothing else, ever
skills/             core skills, domain-neutral            (empty — Phase 3)
agents/             core agents                            (empty — Phase 4)
domains/backend/    domain pack: skills, agents, rules, templates
hooks/              hooks.json (standard) + strict.hooks.json
scripts/lib/        the seam — hook-io, config, changeset, eventlog
scripts/hooks/      one thin file per hook, ~30 lines each
bin/                commands added to the Bash tool PATH
policies/           context budget, memory policy
manifests/          install profiles
schemas/            event and config JSON Schemas
```

Only `plugin.json` and `SCHEMA-NOTES.md` live in `.claude-plugin/`. Component
directories placed there silently fail to load — no error, they just never
appear.

## Dev loop

```bash
claude --plugin-dir ./plugins/team-agents
```

That loads the plugin for one session without installing it. `SKILL.md` edits
apply immediately; changes to `hooks/`, `agents/`, or `settings.json` need
`/reload-plugins`.

Verify:

```bash
claude plugin validate ./plugins/team-agents --strict
```

```bash
claude plugin details team-agents
```

The second command prints the always-on vs on-invoke token cost. **The ceiling is
2,500 always-on tokens** — check it after every content commit. If a change
pushes it over, the fix is a shorter description or
`disable-model-invocation: true`, not a higher ceiling.

## CI

```bash
npm run ci
```

Runs the manifest, hook, agent, skill, and secret validators, then feeds every
fixture in `tests/fixtures/hook-events/` to every registered hook and asserts the
exit codes and output shape. No dependencies to install — the plugin ships zero
runtime deps and the CI suite has none either.

Individual checks:

```bash
node scripts/ci/smoke-hooks.js
```

`check-token-budget.js` needs the Claude Code CLI and exits 0 with a note when it
is unavailable, so it is safe to run anywhere.

## The routing rule

Route every new component through this before writing it:

```
Can a script decide it without model judgment?     -> hook
Must the model know it every turn in a repo?       -> rule
Must the model know it only sometimes?             -> skill
Needs its own context budget + tool allowlist?     -> agent
```

If you actually care about a behaviour, it is a hook. Rules and skills are
context, not enforcement — Claude reads them and tries to comply, with no
guarantee.

## Naming

The marketplace is `sparc-agents` and the plugin is `team-agents`. **Neither is
ever renamed** — both are baked into every teammate's `enabledPlugins`.
Components resolve as `team-agents:<name>`, and a component's frontmatter `name`
must equal its directory or filename, because the name is what gets invoked.
