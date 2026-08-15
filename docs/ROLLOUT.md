# team-agents — Rollout

**Status: not written yet.** This is a Phase 5 deliverable — see
[BUILD-PLAN.md](./BUILD-PLAN.md). The file exists now so the structure in
[ARCHITECTURE.md §4](./ARCHITECTURE.md) is complete and so nothing links into a
void.

When it is written it must cover:

- **Install instructions** — adding the `sparc-agents` marketplace and installing
  `team-agents` with `--scope project`.
- **Profile guidance** — why `standard` is the default, and that `minimal` is the
  escape hatch that stops someone disabling the plugin outright the first time a
  hook annoys them.
- **The `OTEL_LOG_TOOL_DETAILS` warning.** Per-skill and per-agent attribution is
  blank without it, because `sparc-agents` is a third-party marketplace and
  `plugin.name` reports as `"third-party"`. But the flag also surfaces Bash
  commands and file paths, so it is a local development setting and **never** a
  fleet-wide or managed one.
- **The repo-level `.team-agents.json`** — what it overrides and why project
  settings cannot be used for it.

## Install (provisional)

```bash
claude plugin marketplace add <repo-url>
claude plugin install team-agents@sparc-agents --scope project
```

Until Phase 0's acceptance criteria pass on a machine that is not the author's,
treat these commands as untested.
