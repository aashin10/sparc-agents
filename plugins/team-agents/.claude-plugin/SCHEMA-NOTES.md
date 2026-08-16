# SCHEMA-NOTES

Discovered validator and loader behaviour. **Append to this file the moment the
validator rejects something for a non-obvious reason.** This file is the
accumulated cost of every hour lost to a vague error message.

Seeded from `docs/ARCHITECTURE.md` Appendix A.

---

## Layout

- Only `plugin.json` and this file belong in `.claude-plugin/`. All component
  directories go at the **plugin root**. Putting `skills/` or `agents/` inside
  `.claude-plugin/` is the single most common reason components silently fail
  to load — no error, they just do not appear.
- `settings.json` at the plugin root supports **only** `agent` and
  `subagentStatusLine`. Every other key is ignored silently. General
  configuration goes through `userConfig` and `policies/`.
- `bin/` is added to the Bash tool's `PATH` while the plugin is enabled, so its
  contents are invokable as bare commands — by the user *and* by Claude.

## Paths

- All manifest paths are relative to the plugin root and start with `./`.
  The `skills` field additionally accepts `"."`.
- `skills` **adds** to the default `skills/` scan. Do not list `./skills/`.
- `agents`, `commands`, `workflows`, `outputStyles`, `experimental.themes`, and
  `experimental.monitors` **replace** their defaults. List the default path
  explicitly if you want to keep it — that is why `plugin.json` here lists both
  `./agents/` and `./domains/backend/agents/`.
- Copied plugins cannot reference paths outside the plugin root
  (`../shared-lib` breaks after install). Symlinks **within** the plugin are
  preserved; symlinks elsewhere **in the same marketplace** are dereferenced
  during the copy; symlinks outside the marketplace are skipped. That last
  behaviour is the mechanism that makes a future multi-plugin split cheap.

## Field types

- Agent frontmatter `tools` is a comma-separated **scalar**:
  `tools: Read, Grep, Glob`. A YAML sequence (`tools: [Read, Grep]`) is wrong.
  This differs from the array requirement in `plugin.json` and is a common
  source of confusion.
- Skill frontmatter `description` must be an **inline scalar**. Block scalars
  (`|`, `|-`, `>`) preserve newlines and break description-keyed rendering.
- Unrecognized top-level manifest fields are ignored at load time and reported
  as warnings by `claude plugin validate`. `--strict` promotes them to errors,
  which is the point of running it — it catches typo'd keys.
- A wrong *type* on a recognized field usually fails the load outright. The
  exceptions are `experimental` and `metadata`, which are ignored with a warning.
- `$schema` is accepted and ignored at load time. It exists for editor validation.

## Stale guidance seen in the wild

- Older third-party write-ups claim `agents` is rejected by the validator.
  That is **stale**. `agents` is a documented component path field.
- Some reference plugins embed a path-resolution bootstrap closure inside every
  `hooks.json` command string, falling back through `~/.claude` and guessing at
  plugin cache directories. That is unnecessary — `${CLAUDE_PLUGIN_ROOT}` is
  expanded by the loader, including inside `args`. Do not copy that pattern.

## Versioning

- `version` is deliberately omitted from both `plugin.json` and the
  `marketplace.json` entry during the internal phase. With no version in either,
  Claude Code resolves the version from the source's **git commit SHA**, so
  teammates tracking `main` receive updates on every push. Adding an explicit
  `version` pins the plugin and skips updates when matched — do that only at the
  first stable release.

## Marketplace entry `source`

- The shorthand string form (`"source": "./plugins/team-agents"`) is a relative
  path source. The explicit object form is
  `{ "type": "path", "path": "./plugins/team-agents" }`, and the other types are
  `github`, `git`, `url`, `archive`, `npm`, and `command`. If the string form
  ever fails validation, switch to the object form rather than restructuring the
  repo.

## Node dependencies

- Dependencies are installed into the plugin cache only when the plugin root has
  **both** a `package.json` and a supported lockfile: `bun.lock`, `bun.lockb`,
  `npm-shrinkwrap.json`, or `package-lock.json`. `yarn.lock` and
  `pnpm-lock.yaml` are deliberately skipped.
- Install runs with `--ignore-scripts` and a 60-second timeout. Prefer zero
  runtime dependencies: a dependency that fails to install becomes a silent hook
  failure on someone else's machine.

---

## Verified against Claude Code v2.1.233 (Phase 0 acceptance)

Everything below was reproduced against a real CLI, not inferred from docs.
Two of these contradict `docs/ARCHITECTURE.md` §5.1 as written.

### `agents` rejects directory paths — it wants files

`"agents": ["./agents/", "./domains/backend/agents/"]` fails with the maximally
unhelpful `agents: Invalid input`, and the **whole plugin then fails to load** —
no skills, no hooks, no entry in `claude plugin details`. Bisected: any directory
path is rejected; `"./agents/probe.md"` validates. This differs from `skills`,
which does take directories.

Consequences:

- The ARCHITECTURE §5.1 snippet showing `agents` with two directory paths is
  **wrong for this CLI version**. Do not paste it back in.
- Until Phase 4 ships real agent files, the field is omitted entirely and the
  default `./agents/` scan applies.
- When Phase 4 adds agents, either list each `.md` file explicitly, or re-test
  whether directory support has landed. Do not assume.

### `hooks` must reference only *additional* hook files

`hooks/hooks.json` is auto-loaded by convention. Declaring
`"hooks": "./hooks/hooks.json"` in the manifest loads it a second time and the
runtime rejects it:

```
[ERROR] Duplicate hooks file detected: ./hooks/hooks.json resolves to an
already-loaded file. The standard hooks/hooks.json is loaded automatically, so
manifest.hooks should only reference additional hook files.
```

The plugin still loads, but is marked `hook-load-failed` and is not available for
MCP. The field is therefore omitted.

### Profile switching cannot be done by swapping hook files

Follows from the above. A manifest field is static — there is no way to declare
`hooks/hooks.json` for the standard profile and `hooks/strict.hooks.json` for the
strict one, because the manifest cannot vary per profile and the standard file is
always auto-loaded.

**Profile switching is therefore a runtime concern**, implemented in each hook via
`config.load().profile` and `config.gateEnabled(id)`. `stop:quality-gate` reads
the profile to choose advisory (standard) versus blocking (strict) behaviour.

Open item for Phase 5: `hooks/strict.hooks.json` currently duplicates the
`session:banner` id from `hooks.json`. If it is ever declared in the manifest as
an additional file, that hook fires twice. It should be reduced to the
strict-only additive gates (migration guard, commit gate) before being wired up.

### `--strict` fails on a missing `version`

`claude plugin validate <path> --strict` reports `No version specified` as a
**warning**, which `--strict` promotes to an error. This directly conflicts with
locked decision §13.2 (omit `version` so the commit SHA is the version).

Confirmed working as designed: `claude plugin list` shows
`Version: 2d6bbec62a48` — the commit SHA. So the decision is sound and the
warning is cosmetic. Either drop `--strict` from CI, or accept the warning and
gate CI on the non-strict run plus the repo's own validators.

### Marketplace `add` rejects a bare `.`

`claude plugin marketplace add .` fails with "Invalid marketplace source format".
`./.` and an absolute path both work.
