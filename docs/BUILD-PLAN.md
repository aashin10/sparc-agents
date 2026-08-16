# team-agents — Build Plan

Ordered phases with explicit acceptance criteria. Each phase is independently
shippable and independently useful. Do not start a phase until the previous
phase's acceptance criteria pass.

Read [ARCHITECTURE.md](./ARCHITECTURE.md) first. It is the spec; this is the
sequence.

---

## Phase 0 — Skeleton that loads

**Goal:** a real teammate can install it and see it in `/plugin`.

### Tasks

- [ ] `git init` at `sparc-agents/`
- [ ] `.claude-plugin/marketplace.json` (repo root) — see ARCHITECTURE §5.2
- [ ] `plugins/team-agents/.claude-plugin/plugin.json` — see ARCHITECTURE §5.1
- [ ] `plugins/team-agents/package.json` + `package-lock.json` (can be empty deps)
- [ ] `plugins/team-agents/skills/planning/SKILL.md` — one real core skill
- [ ] `plugins/team-agents/hooks/hooks.json` with a single `SessionStart` hook
      that prints one line
- [ ] `plugins/team-agents/scripts/hooks/session-start.js` — trivial, proves the
      `${CLAUDE_PLUGIN_ROOT}` path resolution works
- [ ] `plugins/team-agents/.claude-plugin/SCHEMA-NOTES.md` seeded from
      ARCHITECTURE Appendix A
- [ ] `.gitignore`, `LICENSE`, `CHANGELOG.md`

### Acceptance

```bash
claude plugin validate ./plugins/team-agents --strict     # passes
claude --plugin-dir ./plugins/team-agents                  # loads
/plugin                                                    # team-agents listed
# planning skill invocable as /team-agents:planning
# SessionStart hook line appears in `claude --debug`
```

**Then:** push, add the marketplace on a second machine, install with
`--scope project`, confirm it loads there. Do not proceed until this works on a
machine that is not yours. Everything after this compounds on top of a working
install.

---

## Phase 1 — The seam and the first real guardrails

**Goal:** the enforcement plane exists and is fast enough that nobody wants it off.

### Tasks

- [x] `scripts/lib/hook-io.js` — stdin parse, `allow()`, `block(reason)`,
      `warn()`, `addContext()`
- [x] `scripts/lib/config.js` — profile resolution with the precedence chain
      from ARCHITECTURE §11
- [x] `scripts/lib/classify.js` — path -> `{ domain, layer, project, isTest,
      isMigration, isController, isGenerated }`
- [x] `scripts/lib/changeset.js` — accumulate under `${CLAUDE_PLUGIN_DATA}`
- [x] `scripts/lib/dotnet.js` — solution/project graph; "which projects own
      these files"; "which tests cover these projects"
- [x] `scripts/hooks/pre-config-protection.js`
- [x] `scripts/hooks/post-edit-accumulate.js`
- [x] `scripts/hooks/stop-quality-gate.js` — format, build, scoped test
- [x] `tests/fixtures/hook-events/` — one fixture JSON per hook event
- [x] `scripts/ci/smoke-hooks.js`
- [x] `policies/context-budget.json`, `manifests/install-profiles.json`

### Acceptance

- `stop:quality-gate` completes in **under 10 seconds** on the real target
  solution. If it does not, narrow the scoping before moving on.
- `pre:config-protection` returns in **under 150 ms**.
- `smoke-hooks.js` passes for every hook.
- Editing `Directory.Build.props` through Claude is blocked with a message that
  explains what to do instead.

**This is the phase that carries the value.** Resist skipping to agents.

---

## Phase 2 — Instrumentation

**Goal:** you can answer "what did today cost, and where is my context going?"
before you add content that consumes both.

### Tasks

- [x] `scripts/lib/eventlog.js` + `schemas/event.schema.json` (v1)
- [x] `scripts/lib/transcript.js` — defensive `usage` block parser; records CLI
      version on every row
- [x] `scripts/hooks/session-end-rollup.js` — drains transcript into
      `${CLAUDE_PLUGIN_DATA}/telemetry/`
- [x] `bin/arc-usage` — see the output shape below
- [x] `scripts/hooks/instructions-ledger.js` on `InstructionsLoaded`
- [x] `bin/arc-context` — prints the always-on ledger against the budget
- [x] `scripts/ci/check-token-budget.js`
- [x] Emit events from the Phase 1 hooks through `eventlog.js`

### Target output for `arc-usage`

```
$ arc-usage --since 7d

Total          4.21 M tokens          est. $18.40
  cacheRead    3.02 M  (71.7%)
  cacheCreate  0.71 M  (16.9%)   <- the expensive line
  input        0.31 M
  output       0.17 M

By source        tokens      %     est.$
  main            2.60 M   61.8    11.10
  subagent        1.44 M   34.2     6.30
  auxiliary       0.17 M    4.0     1.00

Top skills                       invocations   tokens
  team-agents:backend-data-access         14    412 K
  team-agents:planning                     9    288 K

Compactions: 6   (avg 142 K -> 31 K, 78% reclaimed)
```

### Acceptance

- `arc-usage` produces a correct rollup for a real session.
- `arc-context` lists every always-on source with its token cost.
- `check-token-budget.js` fails CI when the ceiling is exceeded (test it by
  temporarily lowering the ceiling).
- `transcript.js` degrades gracefully when handed a malformed or
  future-version transcript — it must not throw.

**Why before content:** without this you cannot tell whether skill #7 helped or
just cost 300 always-on tokens forever.

---

## Phase 3 — Core skills and the backend rule pack

**Goal:** domain-neutral knowledge plus the always-on rules a consumer repo copies in.

### Tasks

- [ ] `skills/planning/` — flesh out beyond the Phase 0 stub
- [ ] `skills/adr/`
- [ ] `skills/verification/`
- [ ] `skills/context-hygiene/`
- [ ] `domains/backend/rules/csharp/{style,async,ef-core,api}.md` with `paths:`
      frontmatter
- [ ] A setup path that copies rules into a consumer repo's `.claude/rules/`
- [ ] `scripts/ci/validate-skills.js`

### Acceptance

- Every skill passes `validate-skills.js`.
- `claude plugin details team-agents` still reports always-on cost under 2,500.
- Descriptions do not collide: run 5–10 realistic prompts and confirm the
  intended skill fires each time.

---

## Phase 4 — Backend agents

**Goal:** delegation happens without being asked for.

### Tasks

- [ ] `agents/prior-art-scan.md` (core)
- [ ] `agents/doc-writer.md` (core)
- [ ] `domains/backend/agents/` — the six from ARCHITECTURE §5
- [ ] `domains/backend/skills/` — the eight backend skills
- [ ] `settings.json` (`agent`, `subagentStatusLine`)
- [ ] `scripts/ci/validate-agents.js`

### Acceptance

- Every agent declares an explicit `tools` allowlist; reviewers are read-only.
- Every write-capable agent declares `maxTurns`.
- On a realistic task, Claude delegates to `backend-architect` or a reviewer
  **without being told to**. If it does not, the `description` fields are the
  problem, not the system prompts.
- Always-on cost still under budget after agents are added.

---

## Phase 5 — Profiles, compaction handling, evals

**Goal:** other people can adopt it on their own terms.

### Tasks

- [ ] `hooks/strict.hooks.json` + profile switching in `config.js`
- [ ] `scripts/hooks/compact-reinject.js` on `SessionStart` matcher `compact`
- [ ] `scripts/hooks/pre-compact-snapshot.js` on `PreCompact`
- [ ] `scripts/hooks/pre-memory-bloat.js`
- [ ] `evals/` — golden transcripts asserting delegation and gate firing
- [ ] `docs/ROLLOUT.md` — install instructions, profile guidance, the
      `OTEL_LOG_TOOL_DETAILS` warning
- [ ] GitHub Actions running the full CI suite

### Acceptance

- A teammate installs with `profile=minimal` and reports no friction.
- After a `/compact`, invariants are still being followed.
- Full CI green on a clean clone.

---

---

## Phase 6 — Attribution the transcript cannot give us

**Goal:** answer "what is this MCP server actually costing us?" with a number
you can act on.

### Why this is its own phase

Phase 2 measures spend accurately at the session level and, since the per-tool
extension, measures how much context each tool and MCP server pushes into the
window. It cannot measure billed tokens per MCP server, and neither can anything
else built only on transcripts. Verified against a real session: `message.usage`
is per-REQUEST, and the only tool-adjacent key in it is `server_tool_use`, which
counts Anthropic server-side web_search/web_fetch calls — not MCP. There is no
per-tool or per-server token field to read.

So an MCP server's cost splits into two parts, and only one is solved:

| Part | What it is | Status |
|---|---|---|
| **Flow cost** | Tool results the server pushes into context, re-read on every later request | **Done** — `arc-usage` reports it per server, raw and amplified |
| **Standing cost** | The server's tool names/schemas sitting in the request prefix on *every* request, whether or not the server is ever called | **Not solved.** Not present in the transcript at all. |

Standing cost is the one that surprises people: connect eight MCP servers, call
none of them, and every request still carries their tool surface. ARCHITECTURE
§9.2 notes MCP tool *names* load at startup with schemas deferred, so the
standing cost is smaller than it looks — but "smaller than it looks" is not a
number, and a fleet-wide default should not rest on an assumption.

### Tasks

- [ ] `scripts/lib/mcp.js` — enumerate connected MCP servers and their tool
      surface from the resolved config (user, project, and plugin-provided),
      measuring names and, where loaded, schemas.
- [ ] Standing-cost estimator: tool-surface tokens x requests per session, so
      the always-on figure is comparable to the flow figure `arc-usage` reports.
- [ ] `arc-context`: add connected MCP servers to the always-on ledger, since
      today it accounts for CLAUDE.md, memory, and rules but not MCP.
- [ ] Reconcile the estimate against ground truth from `/context` on a real
      session; record the delta in SCHEMA-NOTES rather than trusting the model.
- [ ] Threshold monitoring: a `Stop`-side check that warns when a session crosses
      a configurable token or cost ceiling, so runaway spend is visible while it
      is happening rather than at the next rollup.
- [ ] OTel adapter behind `transcript.js` (ARCHITECTURE §8.2 Source B). Note
      before committing: the documented attribute set carries `plugin.name`,
      `agent.name`, and `skill.name` — **no MCP server attribute** — so OTel is
      unlikely to close the standing-cost gap on its own. Confirm before building.

### Acceptance

- For a session with at least two MCP servers connected, `arc-usage` reports a
  per-server standing cost and a per-server flow cost, and the two are labelled
  distinctly rather than summed into one misleading number.
- The standing-cost estimate is within a stated tolerance of `/context`, and the
  tolerance is written down.
- Disconnecting an unused MCP server produces a measurable drop in the reported
  always-on figure. If it does not, the estimator is wrong and the phase is not
  done.
- Every figure that is an estimate says so, and anything not derivable is named
  as not derivable rather than approximated silently.

## Explicitly deferred

Do not build these during phases 0–5:

- Multi-plugin split (`agent-core`, `backend-agents`, `agent-governance`)
- MCP servers bundled in the plugin (measuring MCP token cost is Phase 6 —
  bundling one is still out of scope)
- LSP server configuration
- Monitors, themes, channels
- A second domain pack
- Any web dashboard reading the event log
- Cross-harness adapters of any kind

Each of these is a real option later. None of them changes what Phase 1 and
Phase 2 need to look like, which is the point of the ordering.

---

## Working notes

- Develop with `claude --plugin-dir ./plugins/team-agents`, not by installing.
  `/reload-plugins` after every non-skill edit.
- Every hook gets a fixture in the same commit that adds the hook. No exceptions —
  a hook without a fixture is a hook that will break silently three weeks later.
- Append to `.claude-plugin/SCHEMA-NOTES.md` the moment the validator rejects
  something for a non-obvious reason. That file is the accumulated cost of every
  hour lost to a vague error message.
- Run `claude plugin details team-agents` after every content commit. The
  always-on number only ever goes up by accident.
