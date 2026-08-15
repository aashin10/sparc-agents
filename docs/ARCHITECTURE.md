# team-agents — Architecture

**Marketplace:** `sparc-agents`
**Plugin:** `team-agents`
**Status:** design locked, pre-implementation
**Target runtime:** Claude Code (plugin system)

This is the reference document. It defines what exists, where it lives, and why.
For the ordered task list, see [BUILD-PLAN.md](./BUILD-PLAN.md). For conventions
enforced while building, see the repo-root `CLAUDE.md`.

---

## 1. Identity and naming

| Thing | Value | Notes |
|---|---|---|
| Marketplace name | `sparc-agents` | Install source. Never rename — renaming breaks every teammate's `enabledPlugins`. |
| Plugin name | `team-agents` | Namespace prefix for every component. |
| Repo | `sparc-agents/` | Marketplace repo containing `plugins/team-agents/`. |

Components are namespaced as `<plugin-name>:<component-name>`:

```
team-agents:planning                 # core skill
team-agents:backend-api-design       # backend domain skill
team-agents:backend-architect        # backend domain agent
```

**Naming rules**

- Plugin and marketplace names are kebab-case, lowercase, no spaces. Use
  `displayName` in the manifest for anything human-facing.
- Skill and agent directory name **must equal** the frontmatter `name` field.
- Domain-owned components carry the domain in the name: `backend-<topic>`.
  The path alone is not enough — the frontmatter `name` is what gets invoked,
  and `team-agents:api-design` becomes ambiguous the moment a second domain
  exists.

---

## 2. Design principles

### 2.1 The four planes

Everything the plugin ships belongs to exactly one plane.

| Plane | Mechanism | Context cost | Can the model ignore it? |
|---|---|---|---|
| **P0 — Enforcement** | Hooks + scripts | Zero | **No.** Deterministic code. |
| **P1 — Ambient** | Rules, output styles | Always-on tokens | Yes — it is just text. |
| **P2 — Knowledge** | Skills | On-invoke tokens | Yes. |
| **P3 — Delegation** | Subagents | Separate context window | N/A — it *is* the agent. |

### 2.2 The routing rule

Apply to every single component before writing it:

```
Can a script decide it without model judgment?           -> P0 hook
Must the model know it on every turn in this repo?       -> P1 rule (path-scoped)
Must the model know it only sometimes?                   -> P2 skill
Does it need its own context budget, a different tool
  allowlist, and a summarized return?                    -> P3 agent
```

**If you actually care about it, it is a hook.** CLAUDE.md files and rules are
context, not enforced configuration — Claude reads them and tries to comply,
with no guarantee. Reserve P1 and P2 for things where you want judgment.
Reserve P0 for things where you want compliance.

### 2.3 Anti-goals

The reference implementation this project draws from (ECC) ships 284 skills and
68 agents across nine agent harnesses. Explicitly **not** doing that:

- No multi-harness adapters. One runtime: Claude Code.
- No large skill catalogue. Every skill description is always-on context, and
  overlapping descriptions make routing worse, not better. Hard budget in §9.
- No hand-duplicated boilerplate across component files. If it needs to be in
  every agent, generate it at build time.
- No path-resolution bootstrap logic inside `hooks.json`. Use
  `${CLAUDE_PLUGIN_ROOT}`.

---

## 3. Topology — generic core, domain packs, one plugin

`team-agents` is domain-neutral. Domain content lives in `domains/<name>/`.
The first release ships only `domains/backend/`.

This works because of two specific manifest behaviours:

- **`skills` *adds* to the default `skills/` scan.** Listed directories load
  alongside it.
- **`agents` *replaces* the default `agents/` directory.** Every path you want
  must be listed, including the default.

Adding a second domain is therefore one array entry in the manifest plus a
directory.

### 3.1 The core/domain test

> Would a frontend or data engineer also want this?

Yes -> `skills/` or `agents/` (core).
Mentions `dotnet`, EF Core, Service Bus, MassTransit, or SQL Server -> `domains/backend/`.

Apply it strictly. The "generic plugin" claim collapses the first time
C#-specific guidance leaks into a core skill.

### 3.2 Why one plugin, not several

The marketplace wrapper costs one JSON file and makes a future split into
`agent-core` / `backend-agents` / `agent-governance` a non-event. Splitting
*without* it means changing the install source for everyone.

Relevant constraint for a future split: copied plugins cannot reference files
outside their own directory (`../shared-lib` breaks after install). Symlinks
that resolve **elsewhere within the same marketplace** are dereferenced during
the copy, so `plugins/backend-agents/scripts/lib -> ../../agent-core/scripts/lib`
works. That is the mechanism that makes the split cheap later.

---

## 4. Directory structure

```
sparc-agents/                                # marketplace repo (git root)
├── CLAUDE.md                                # conventions for building this repo
├── .claude-plugin/
│   └── marketplace.json
│
├── plugins/
│   └── team-agents/                         # <- plugin root
│       ├── .claude-plugin/
│       │   ├── plugin.json                  # ONLY this file lives here
│       │   └── SCHEMA-NOTES.md              # discovered validator behaviour
│       │
│       ├── skills/                          # CORE — domain-neutral
│       │   ├── planning/SKILL.md
│       │   ├── adr/SKILL.md
│       │   ├── verification/SKILL.md
│       │   └── context-hygiene/SKILL.md
│       │
│       ├── agents/                          # CORE
│       │   ├── prior-art-scan.md
│       │   └── doc-writer.md
│       │
│       ├── domains/
│       │   └── backend/
│       │       ├── skills/
│       │       │   ├── backend-api-design/SKILL.md
│       │       │   ├── backend-data-access/SKILL.md
│       │       │   ├── backend-migration-safety/
│       │       │   │   ├── SKILL.md
│       │       │   │   └── scripts/scan_migration.py
│       │       │   ├── backend-async-concurrency/SKILL.md
│       │       │   ├── backend-messaging/SKILL.md
│       │       │   ├── backend-error-handling/SKILL.md
│       │       │   ├── backend-observability/SKILL.md
│       │       │   └── backend-testing/SKILL.md
│       │       ├── agents/
│       │       │   ├── backend-architect.md
│       │       │   ├── backend-api-reviewer.md
│       │       │   ├── backend-data-reviewer.md
│       │       │   ├── backend-build-resolver.md
│       │       │   ├── backend-test-author.md
│       │       │   └── backend-security-reviewer.md
│       │       ├── rules/                   # copied INTO consumer repos, not loaded from here
│       │       │   ├── csharp/style.md
│       │       │   ├── csharp/async.md
│       │       │   ├── csharp/ef-core.md
│       │       │   └── csharp/api.md
│       │       └── templates/
│       │           ├── vertical-slice/
│       │           ├── consumer/
│       │           └── integration-test/
│       │
│       ├── hooks/
│       │   ├── hooks.json                   # standard profile
│       │   └── strict.hooks.json
│       │
│       ├── scripts/
│       │   ├── lib/                         # THE SEAM — see §6
│       │   │   ├── hook-io.js
│       │   │   ├── config.js
│       │   │   ├── classify.js
│       │   │   ├── changeset.js
│       │   │   ├── eventlog.js
│       │   │   ├── transcript.js
│       │   │   └── dotnet.js                # domain-specific, isolated here
│       │   └── hooks/                       # one file per hook, ~30 lines each
│       │
│       ├── bin/                             # added to Bash tool PATH when enabled
│       │   ├── arc-usage
│       │   ├── arc-context
│       │   └── arc-lint
│       │
│       ├── policies/
│       │   ├── context-budget.json
│       │   └── memory-policy.json
│       ├── manifests/
│       │   └── install-profiles.json
│       ├── schemas/
│       │   ├── event.schema.json
│       │   └── team-agents-config.schema.json
│       ├── settings.json                    # only `agent` + `subagentStatusLine` keys
│       ├── package.json
│       ├── package-lock.json                # required for auto dep install
│       └── CHANGELOG.md
│
├── scripts/ci/                              # validates the PLUGIN, not user code
│   ├── validate-manifest.js
│   ├── validate-agents.js
│   ├── validate-skills.js
│   ├── validate-hooks.js
│   ├── check-token-budget.js
│   └── smoke-hooks.js
├── tests/fixtures/hook-events/              # canned stdin JSON per hook event
├── evals/                                   # golden transcripts
└── docs/
    ├── ARCHITECTURE.md                      # this file
    ├── BUILD-PLAN.md
    └── ROLLOUT.md
```

**Hard rule:** only `plugin.json` and `SCHEMA-NOTES.md` live in
`.claude-plugin/`. Every other component directory must be at the plugin root.
Putting `skills/` or `agents/` inside `.claude-plugin/` is the single most
common reason components silently fail to load.

---

## 5. Manifests

### 5.1 `plugins/team-agents/.claude-plugin/plugin.json`

```jsonc
{
  "$schema": "https://json.schemastore.org/claude-code-plugin-manifest.json",
  "name": "team-agents",
  "displayName": "SPARC Team Agents",
  "description": "Shared agent layer for the SPARC team. Ships the backend pack: .NET/C#, EF Core, SQL Server, Azure Service Bus, MassTransit.",
  "author": { "name": "SPARC" },
  "license": "MIT",
  "keywords": ["agents", "skills", "hooks", "backend", "dotnet", "guardrails"],

  // skills ADDS to the default ./skills/ scan — do not list ./skills/ here
  "skills": ["./domains/backend/skills/"],

  // agents REPLACES the default — both paths must be listed
  "agents": ["./agents/", "./domains/backend/agents/"],

  "hooks": "./hooks/hooks.json",

  "userConfig": {
    "profile": {
      "type": "string",
      "title": "Guardrail profile",
      "description": "minimal | standard | strict. Invalid values fall back to standard.",
      "default": "standard"
    },
    "domains": {
      "type": "string",
      "title": "Active domain packs",
      "description": "Which domain packs to activate.",
      "multiple": true,
      "default": ["backend"]
    },
    "track_usage": {
      "type": "boolean",
      "title": "Local token tracking",
      "description": "Write per-session token and cost rollups to the plugin data directory.",
      "default": true
    },
    "context_budget": {
      "type": "number",
      "title": "Always-on token ceiling",
      "description": "Fail CI when the plugin's always-on context cost exceeds this.",
      "default": 2500
    }
  }
}
```

**`version` is deliberately omitted.** With no `version` in either the manifest
or the marketplace entry, Claude Code resolves the version from the source's git
commit SHA — so teammates track `main` and receive updates on every push. Add an
explicit `version` only when the plugin reaches a stable release cadence.

### 5.2 `.claude-plugin/marketplace.json` (repo root)

```jsonc
{
  "name": "sparc-agents",
  "owner": { "name": "SPARC" },
  "metadata": {
    "description": "SPARC internal agent marketplace"
  },
  "plugins": [
    {
      "name": "team-agents",
      "source": "./plugins/team-agents",
      "description": "Shared agent layer. Backend pack ships first.",
      "category": "workflow"
    }
  ]
}
```

### 5.3 `settings.json` (plugin root)

Only two keys are supported here: `agent` and `subagentStatusLine`. Anything
else is ignored. Use it to set subagent defaults, not general configuration —
general configuration goes through `userConfig` and `policies/`.

---

## 6. The shared library — `scripts/lib/`

This is the highest-leverage part of the codebase and the reason hook #12 costs
an afternoon instead of a day. Build it before building hooks.

| Module | Responsibility |
|---|---|
| `hook-io.js` | Read and parse stdin JSON, normalize the payload, expose `allow()` / `block(reason)` / `warn(msg)` / `addContext(text)` with correct exit semantics. Every hook becomes ~30 lines. |
| `config.js` | Resolve the effective config. Precedence: repo `.team-agents.json` > `CLAUDE_PLUGIN_OPTION_*` env > profile default. |
| `classify.js` | Given a path, return `{ domain, layer, project, isTest, isMigration, isController, isGenerated }`. Every hook needs this and nobody writes it once. |
| `changeset.js` | Accumulate files touched during a turn under `${CLAUDE_PLUGIN_DATA}`; `Stop` drains it. |
| `eventlog.js` | Append-only JSONL writer, schema-versioned. |
| `transcript.js` | Defensive parser for session transcript `usage` blocks. See §8. |
| `dotnet.js` | Solution/project graph. "Which projects own these files", "which tests cover these projects". The only domain-coupled module in `lib/`. |

### 6.1 Environment variables

| Variable | Resolves to | Use for |
|---|---|---|
| `${CLAUDE_PLUGIN_ROOT}` | Plugin install directory | Bundled scripts, configs, templates |
| `${CLAUDE_PLUGIN_DATA}` | `~/.claude/plugins/data/<id>/` — survives updates | **Everything you write**: telemetry, changesets, caches |
| `${CLAUDE_PROJECT_DIR}` | Project root | Project-local scripts and config |

**Never write state under `${CLAUDE_PLUGIN_ROOT}`.** It changes on every plugin
update and old version directories are swept after a grace period.

### 6.2 Node dependencies

Claude Code installs a plugin's npm dependencies into the cache only when the
plugin root contains **both** a `package.json` and a supported lockfile
(`bun.lock`, `bun.lockb`, `npm-shrinkwrap.json`, or `package-lock.json`).
`yarn.lock` and `pnpm-lock.yaml` are deliberately skipped. Ship
`package-lock.json`. Install runs with `--ignore-scripts` and a 60-second
timeout.

Prefer zero runtime dependencies for hooks. Node's standard library covers
everything `lib/` needs, and a dependency that fails to install becomes a silent
hook failure on someone else's machine.

---

## 7. Component conventions

### 7.1 Skills

Structure:

```
<skill-name>/
├── SKILL.md          # required
├── references/       # loaded on demand, not at invoke
├── scripts/          # executable — can run without entering context
└── assets/           # templates, fixtures
```

Progressive disclosure has three levels, and the cost of each is different:

1. **Frontmatter `name` + `description`** — in context on *every* session.
2. **`SKILL.md` body** — in context only when the skill fires.
3. **`references/` and `scripts/`** — read on demand; scripts can execute
   without their source entering context at all.

**Rules (enforced by `validate-skills.js`):**

- `SKILL.md` under 500 lines. Over that, add a `references/` layer and point to
  it explicitly from `SKILL.md`.
- `description` must be an **inline scalar**. Never a block scalar (`|`, `|-`,
  `>`) — block scalars preserve newlines and break description-keyed rendering.
- `description` states **what it does** *and* **when to use it**. The "when"
  clause is the routing surface; all trigger information belongs here, not in
  the body. Lean slightly pushy — the common failure is under-triggering.
- No two skills share a primary trigger phrase.
- Directory name equals frontmatter `name`.
- Imperative voice. Explain *why* a constraint exists rather than stacking MUSTs.

**Put the most important instructions at the top of `SKILL.md`.** After
compaction, invoked skill bodies are re-injected but truncated at 5,000 tokens
per skill (25,000 total, oldest dropped first), and truncation keeps the *start*
of the file. Critical constraints written at the bottom silently disappear.

**`disable-model-invocation: true`** removes the description from the always-on
listing entirely — the skill costs zero context until invoked as `/name`. Use it
for anything with side effects (deploy, commit, migrate) and for rarely-needed
reference material.

### 7.2 Agents

```markdown
---
name: backend-architect
description: What this agent specializes in and when Claude should invoke it.
tools: Read, Grep, Glob
model: opus
maxTurns: 20
---

System prompt.
```

**Rules (enforced by `validate-agents.js`):**

- `tools` is a **comma-separated scalar**, not a YAML sequence. `tools: Read, Grep, Glob`.
- `tools` is **mandatory in this repo**. Omitting it grants access to every tool.
- Reviewer agents are read-only (`Read, Grep, Glob` and optionally `Bash`).
  A reviewer that can edit will fix its own findings and destroy the audit trail.
- Any agent with write access declares `maxTurns`.
- Directory-relative filename equals frontmatter `name`.

**Supported frontmatter for plugin-shipped agents:** `name`, `description`,
`model`, `effort`, `maxTurns`, `tools`, `disallowedTools`, `skills`, `memory`,
`background`, `isolation` (only valid value: `"worktree"`).

**Rejected for plugin-shipped agents, for security:** `hooks`, `mcpServers`,
`permissionMode`.

**Agents are context firewalls first, specialists second.** A subagent gets its
own context window: it loads CLAUDE.md and skills fresh, does its work, and only
its final text response returns to the parent. A research agent can read 30k
tokens and hand back 400. That is the primary reason the reviewer roster exists.

Note: the main conversation's auto memory is **not** loaded into subagents. An
agent that needs persistent knowledge declares its own `memory:` field, which
points at a separate directory.

### 7.3 Hooks

Location: `hooks/hooks.json` at plugin root. Hook types: `command`, `http`,
`mcp_tool`, `prompt`, `agent`.

**Exit semantics (`command` type):**

| Exit | Effect |
|---|---|
| `0` | Allow. **Plain stdout goes to the debug log only — it does not enter context.** |
| `2` | Block. stderr is fed back to the model. On `PostToolUse` it surfaces as an error but cannot block, since the tool already ran. |
| other | Non-blocking error. |

To put text into Claude's context, emit JSON on stdout with
`hookSpecificOutput.additionalContext`. That content enters context untruncated,
so keep it short.

**Rules:**

- Every `PreToolUse` hook returns in **under 150 ms**. It runs on every matching
  tool call and the latency is felt directly. Anything slower moves to `Stop`.
- Commands reference scripts via `"${CLAUDE_PLUGIN_ROOT}"/scripts/hooks/<name>.js`,
  quoted. Prefer exec form with `args` where available.
- `${user_config.*}` is **rejected in shell-form hook commands** (shell injection
  risk). Read `CLAUDE_PLUGIN_OPTION_<KEY>` from the environment instead.
- Every hook has a stable `id` and a one-line `description`.
- Every hook has a fixture in `tests/fixtures/hook-events/` and is exercised by
  `smoke-hooks.js`.

### 7.4 Rules

`domains/backend/rules/` are **not loaded from the plugin.** Plugins contribute
context through skills, agents, and hooks; a `CLAUDE.md` at the plugin root is
not loaded as project context. These files are templates that a setup command
copies into a consumer repo's `.claude/rules/`.

Rule files use `paths:` frontmatter so they load only when Claude touches
matching files:

```markdown
---
paths:
  - "src/**/*.cs"
  - "**/Migrations/**/*.cs"
---
# EF Core conventions
- Never call .Result or .Wait(); await with a CancellationToken.
```

Rules **without** `paths:` load unconditionally at launch and cost always-on
context. Rules **with** `paths:` are cheap but are lost at compaction until a
matching file is read again (see §9.2).

### 7.5 `bin/`

Files in `bin/` are added to the Bash tool's `PATH` while the plugin is enabled
and are invokable as bare commands. This means **Claude itself can run them** —
`arc-usage` lets the model report its own spend when asked.

Keep them dependency-free and fast. They are user-facing surface.

---

## 8. Telemetry and token tracking

### 8.1 Built-ins (available before you build anything)

| Command | Answers |
|---|---|
| `/context`, `/context all` | Where the window is going right now, by category |
| `/cost` | Session cost. Not meaningful on Max/Pro subscriptions. |
| `/usage` | Plan limit headroom |
| `claude plugin details team-agents` | **Always-on vs on-invoke token cost of this plugin** |

The last one is the number CI gates on.

### 8.2 Data sources for `arc-usage`

**Source A — session transcript.** A `Stop` or `SessionEnd` hook receives
`transcript_path` in its stdin payload, pointing at
`~/.claude/projects/<project>/*.jsonl`. Assistant entries carry a `usage` block
with input, output, cache-read, and cache-creation counts.

- Zero infrastructure, works offline, available immediately.
- **The transcript entry format is internal to Claude Code and changes between
  versions.** `transcript.js` must parse defensively: wrap in try/catch, treat
  missing fields as zero, and record the CLI version on every row so a breaking
  release is visible rather than silent.

**Source B — OpenTelemetry.** The supported contract.

```bash
export CLAUDE_CODE_ENABLE_TELEMETRY=1
export OTEL_METRICS_EXPORTER=otlp
export OTEL_LOGS_EXPORTER=otlp
export OTEL_EXPORTER_OTLP_PROTOCOL=http/protobuf
export OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4318
export OTEL_LOG_TOOL_DETAILS=1      # see warning below
```

Relevant signals:

| Signal | Useful attributes |
|---|---|
| `claude_code.token.usage` | `type` (`input`/`output`/`cacheRead`/`cacheCreation`), `model`, `query_source` (`main`/`subagent`/`auxiliary`), `agent.name`, `skill.name`, `plugin.name` |
| `claude_code.cost.usage` | same attribution set |
| `claude_code.api_request` (event) | `cost_usd`, per-type token counts, `request_id`, `duration_ms` |
| `claude_code.compaction` (event) | `trigger`, `pre_tokens`, `post_tokens` |
| `claude_code.subagent_completed` (event) | `agent_type`, `total_tokens`, `total_tool_uses`, `duration_ms` |
| `claude_code.skill_activated` (event) | `skill.name`, `invocation_trigger`, `skill.source` |

> **Attribution warning.** `sparc-agents` is a third-party marketplace. By
> default `plugin.name` reports as `"third-party"`, skill names collapse to
> `"custom_skill"`, and agent names to `"custom"`. Per-skill and per-agent
> attribution — the entire point of the dashboard — is blank unless
> `OTEL_LOG_TOOL_DETAILS=1` is set. That flag also surfaces Bash commands and
> file paths, so it is a **local development setting, never a fleet-wide one.**

**Decision: ship Source A first.** Put a normalizing interface in
`transcript.js` from day one so Source B is an adapter swap, not a rewrite.

### 8.3 Two metrics that are easy to misread

- `subagent_completed.total_tokens` is the footprint of the subagent's **final
  API request only** — roughly its context size at completion. It is *not* a sum
  across the run. For real subagent spend, filter the token counter on
  `query_source == "subagent"`.
- Cache reads cost far less per token than fresh input tokens. Raw token totals
  overstate actual spend. Weight by type before drawing conclusions; cache
  *creation* is the expensive line.

### 8.4 Event schema

All plugin-emitted events go to `${CLAUDE_PLUGIN_DATA}/events/YYYY-MM-DD.jsonl`,
validated against `schemas/event.schema.json`:

```jsonc
{
  "v": 1,                       // schema version — bump on any field change
  "ts": "2026-08-15T09:31:04Z",
  "session_id": "…",
  "turn": 14,
  "event": "pre_tool_use",      // hook event or plugin-defined
  "tool": "Edit",
  "agent": "backend-data-reviewer",
  "files": ["src/Api/Controllers/PlanController.cs"],
  "decision": "allow",          // allow | block | warn
  "rule_id": "pre:config-protection",
  "duration_ms": 42,
  "meta": {}
}
```

Version it and validate it in CI. Event schemas rot silently, and this file is
the groundwork for any later governance or review dashboard.

---

## 9. Context and memory model

This section is the mental model the whole plugin is built around. It is worth
internalizing before writing any component.

### 9.1 Two blocks

Everything in a context window sits in one of two blocks, and **which block
something lands in is determined by how it was loaded, not by how important it
is.**

- **Startup block** — read from disk before the first prompt. Lives outside the
  message history, so it is re-read and re-injected after compaction.
- **Conversation block** — everything that arrives through the conversation.
  Summarized away on compaction.

### 9.2 The ledger

| Source | Loaded when | Survives compaction? |
|---|---|---|
| System prompt, output style | startup | Yes — not in message history |
| `~/.claude/CLAUDE.md` | startup | Re-injected from disk |
| Project `CLAUDE.md`, unscoped `.claude/rules/*.md` | startup | Re-injected from disk |
| Auto memory `MEMORY.md` | startup (first 200 lines / 25 KB) | Re-injected from disk |
| MCP tool *names* | startup (schemas deferred by default) | Reloads |
| **Skill descriptions** | startup | **No.** Only skills actually invoked are preserved |
| Rules with `paths:` frontmatter | when a matching file is read | **Lost** until re-read |
| Nested `CLAUDE.md` in subdirectories | when a file there is read | **Lost** until re-read |
| Invoked skill bodies | on invoke | Re-injected; 5 K/skill cap, 25 K total, oldest dropped |
| File reads, tool output, messages | during work | Summarized |
| Hook `additionalContext` output | on hook fire | Summarized |
| Hooks themselves | — | N/A — code, not context |

This table explains nearly every "why did Claude forget?" moment. The canonical
one: a carefully-written path-scoped rule works for an hour, compaction fires,
and it is gone until Claude next opens a matching file.

### 9.3 The five levers

**1. Placement** — the same sentence has four possible homes:

| Home | Cost | Lifespan |
|---|---|---|
| Typed in chat | one-time | dies at compaction |
| Path-scoped rule | only when matching files open | dies at compaction, returns on next match |
| Project `CLAUDE.md` | every session | permanent |
| `PreToolUse` hook | zero context | permanent *and* unignorable |

If an instruction must survive compaction, drop the `paths:` frontmatter or move
it to project-root `CLAUDE.md`. If it must be *obeyed*, make it a hook.

**2. Scoping** — `paths:` frontmatter keeps 3,000 tokens of C# guidance out of a
session spent editing YAML.

**3. Deferral** — skills load descriptions only; `disable-model-invocation: true`
removes even that.

**4. Isolation** — subagents burn their own window and return a summary. The
single most under-used context lever.

**5. Reset** —

| Command | Use when |
|---|---|
| `/compact focus on <topic>` | Before a long new phase; you choose what the summary keeps |
| `/autocompact 500k` | Set the fill level that triggers automatic compaction |
| `/clear` | Switching to unrelated work. Same task -> too aggressive. |
| `/context all` | Any time you are wondering where the window went |

### 9.4 Memory: two systems

| | CLAUDE.md | Auto memory |
|---|---|---|
| Written by | You | Claude |
| Contains | Instructions and rules | Learnings, build commands, preferences |
| Location | Managed policy / `~/.claude/` / project / `CLAUDE.local.md` | `~/.claude/projects/<project>/memory/` |
| Loaded | Every session, in full | Every session, first 200 lines or 25 KB of `MEMORY.md` |

`MEMORY.md` is an index; topic files beside it (`debugging.md`, etc.) load only
on demand. Auto memory is machine-local, and all worktrees of a repo share one
directory.

**Both are context, not enforcement.** Neither guarantees compliance. That is
the entire reason this plugin ships hooks.

**Controls:**

| Control | Where | Effect |
|---|---|---|
| `/memory` | in session | Browse and edit all memory files; toggle auto memory |
| `autoMemoryEnabled: false` | `settings.json`, any scope | Off for that project |
| `CLAUDE_CODE_DISABLE_AUTO_MEMORY=1` | env | Off everywhere |
| `autoMemoryDirectory` | `settings.json` | Relocate the memory directory |
| `claudeMdExcludes: ["glob"]` | `settings.json` | Skip specific CLAUDE.md files. Arrays merge across layers. |
| `/doctor` | in session | Proposes trims to a checked-in CLAUDE.md |

**Team policy (locked):** auto memory stays **personal**, at the default
location. Shared knowledge lives in version-controlled `CLAUDE.md` and
`.claude/rules/`. Pointing `autoMemoryDirectory` at a checked-in folder means
Claude commits unreviewed notes to the repo — rejected.

### 9.5 What the plugin ships to make this controllable

| Component | Event | Purpose |
|---|---|---|
| `instructions:ledger` | `InstructionsLoaded` | Records every instruction file loaded, its size, and its trigger. **The debugging tool for "why isn't my rule firing?"** |
| `pre:memory-bloat` | `PreToolUse` on `Write\|Edit` matching `CLAUDE.md`, `.claude/rules/**`, `MEMORY.md` | Blocks writes that push a memory file past its line budget |
| `session:compact-reinject` | `SessionStart`, matcher `compact` | Fires **after** compaction. Re-states invariants into the fresh window. |
| `pre:compact-snapshot` | `PreCompact` | Dumps task state, decisions, and open threads to a file before the window turns over |
| `bin/arc-context` | — | Prints the always-on ledger, flagged against `policies/context-budget.json` |
| `check-token-budget.js` | CI | Fails the build when always-on cost exceeds the ceiling |

**Always-on token ceiling: 2,500.** This is the guardrail that prevents
`team-agents` from becoming a 284-skill catalogue.

---

## 10. Guardrail inventory

Four categories. Ship all four.

### Preventive — `PreToolUse`, exit 2 blocks

| ID | Matcher | Blocks |
|---|---|---|
| `pre:config-protection` | `Edit\|Write\|MultiEdit` | Edits to `.editorconfig`, `Directory.Build.props`, `*.ruleset`, `.globalconfig`. Steers the agent to fix code instead of weakening the rules. |
| `pre:memory-bloat` | `Edit\|Write` | Memory/rule files exceeding their line budget |
| `pre:secret-write` | `Edit\|Write` | Connection strings, keys, tokens into tracked files |
| `pre:migration-guard` | `Bash` | `dotnet ef database update` without a reviewed migration; destructive operations in migration files |
| `pre:no-verify-block` | `Bash` | `git commit --no-verify`, force-push to protected branches |
| `pre:commit-gate` | `Bash` | `git commit` when the changeset has not passed build and test |
| `pre:investigate-first` | `Edit\|Write` | First write to a file the agent has not `Read` |

### Corrective — `PostToolUse`, non-blocking

Accumulate the changeset only. **Never run heavy tooling here.**

### Deferred — `Stop`

```
stop:quality-gate
  1. read the changeset manifest written by PostToolUse
  2. dotnet format --verify-no-changes   (touched projects only)
  3. dotnet build -warnaserror           (touched projects only)
  4. dotnet test --filter                (tests reachable from touched projects)
  5. feed failures back into the transcript
```

Scoping to touched projects is not optional. A full solution build on every
`Stop` and the team disables the plugin within a week.

### Detective / advisory — `SessionStart`, `SessionEnd`, `SubagentStop`, `InstructionsLoaded`

Context ledger, telemetry rollup, compaction re-injection, session state.

---

## 11. Configuration and profiles

| Profile | Contents |
|---|---|
| `minimal` | Skills, agents, rules. **No hooks.** For skeptics and for CI. |
| `standard` | + format, config-protection, secret scan, advisory build |
| `strict` | + blocking build/test gate, migration guard, commit gate |

Ship `standard` as the default and `minimal` as the escape hatch. The escape
hatch is what prevents someone disabling the plugin outright the first time a
hook annoys them.

**Config precedence** (implemented in `scripts/lib/config.js`):

```
repo .team-agents.json  >  CLAUDE_PLUGIN_OPTION_*  >  profile default
```

Repo-level config needs its own file because `pluginConfigs` values are read
only from user settings, `--settings`, and managed settings — **project settings
are deliberately ignored**, since a cloned repository could otherwise inject
values into hook commands and MCP configs.

---

## 12. CI validation

The plugin's own CI. Non-negotiable once more than one person depends on it.

| Check | What it catches |
|---|---|
| `claude plugin validate ./plugins/team-agents --strict` | Manifest errors. `--strict` promotes unrecognized-field warnings to errors, catching typo'd keys. |
| `validate-agents.js` | Missing `name` / `description` / `tools`; `tools` written as a YAML sequence; filename/name mismatch |
| `validate-skills.js` | Missing or empty `SKILL.md`; block-scalar `description`; over 500 lines; directory/name mismatch |
| `validate-hooks.js` | Schema conformance; missing `id` or `description`; unquoted `${CLAUDE_PLUGIN_ROOT}` |
| `smoke-hooks.js` | **Feeds each fixture in `tests/fixtures/hook-events/` to each hook's stdin and asserts exit code and stderr shape.** Hooks are the part that breaks silently and the part users blame the plugin for. |
| `check-token-budget.js` | Always-on cost above the ceiling, read from `claude plugin details` |
| `validate-no-personal-paths.js` | Absolute or home-directory paths, secrets |

Plus golden-transcript evals under `evals/`: run a fixed task, assert the right
agent was delegated to and the right gates fired.

---

## 13. Locked decisions

1. **Marketplace `sparc-agents`, plugin `team-agents`.** Never renamed.
2. **`version` omitted** from both manifests during the internal phase, giving
   commit-SHA versioning. Add it at first stable release.
3. **One plugin, domain-partitioned internally.** Split into multiple plugins
   only when a second team owns a domain.
4. **Token source: transcript first, OTel later**, behind a normalizing
   interface from day one.
5. **`OTEL_LOG_TOOL_DETAILS=1` is dev-machine-only**, documented in
   `docs/ROLLOUT.md`, never in managed settings.
6. **Auto memory stays personal.** Shared knowledge goes in version control.
7. **Always-on context ceiling: 2,500 tokens**, enforced in CI.
8. **Every agent declares an explicit `tools` allowlist.** Reviewers are read-only.
9. **`PreToolUse` budget: 150 ms.** Heavier work moves to `Stop`.

---

## Appendix A — Manifest gotchas

Seed `SCHEMA-NOTES.md` with these and append as more are discovered.

- Only `plugin.json` belongs in `.claude-plugin/`. All component directories go
  at the plugin root.
- All manifest paths are relative to the plugin root and start with `./`. The
  `skills` field additionally accepts `"."`.
- `skills` **adds** to the default scan. `agents`, `commands`, `workflows`,
  `outputStyles`, `experimental.themes`, and `experimental.monitors` **replace**
  their defaults — list the default path explicitly if you want to keep it.
- Agent frontmatter `tools` is a comma-separated **scalar**. A YAML sequence
  (`tools: [Read, Grep]`) is wrong. This differs from the array requirement in
  `plugin.json` and is a common source of confusion.
- Unrecognized top-level manifest fields are ignored at load time and reported
  as warnings by `claude plugin validate`. `--strict` promotes them to errors.
- A wrong *type* on a recognized field usually fails the load outright
  (exception: `experimental` and `metadata`, which are ignored with a warning).
- Older third-party guidance claims `agents` is rejected by the validator. That
  is **stale**. `agents` is a documented component path field.
- Copied plugins cannot reference paths outside the plugin root. Symlinks within
  the plugin are preserved; symlinks elsewhere in the same marketplace are
  dereferenced; symlinks outside the marketplace are skipped.

## Appendix B — Development loop

```bash
# load without installing, for the current session only
claude --plugin-dir ./plugins/team-agents

# after every edit
/reload-plugins

# verify
/plugin                          # skills appear as team-agents:<name>
/agents                          # agents appear
claude plugin validate ./plugins/team-agents --strict
claude plugin details team-agents   # always-on token cost
claude --debug                   # loading errors, skipped components
```

`SKILL.md` edits take effect immediately in the current session. Changes to
`hooks/`, `agents/`, `.mcp.json`, and `output-styles/` require `/reload-plugins`
or a restart.
