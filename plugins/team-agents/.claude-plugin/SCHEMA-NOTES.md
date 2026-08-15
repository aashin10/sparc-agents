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
