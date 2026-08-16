#!/usr/bin/env node
'use strict';

/**
 * stop:quality-gate — Stop
 *
 * Reads the changeset accumulated by post:edit-accumulate, then runs format and
 * build (and, under the strict profile, tests) against only the projects that
 * were actually touched.
 *
 * Scoping is the whole design. A full solution build on every Stop and the team
 * disables the plugin within a week, which costs more than the gate ever saved.
 *
 * Profiles (ARCHITECTURE §11):
 *   standard — format + build, advisory. Failures go back as context.
 *   strict   — format + build + test, blocking. Failures exit 2.
 *   minimal  — off.
 */

const path = require('path');
const { spawnSync } = require('child_process');
const { run } = require('../lib/hook-io');
const config = require('../lib/config');
const changeset = require('../lib/changeset');
const eventlog = require('../lib/eventlog');
const { sourceFiles } = require('../lib/classify');
const dotnet = require('../lib/dotnet');

const RULE_ID = 'stop:quality-gate';
const TOTAL_BUDGET_MS = 8000;    // leaves headroom under the 10 s acceptance ceiling
const STEP_TIMEOUT_MS = 6000;
const MAX_PROJECTS = 4;          // beyond this, scoping has stopped meaning anything

function haveDotnet() {
  const probe = spawnSync('dotnet', ['--version'], { encoding: 'utf8', timeout: 4000 });
  return !probe.error && probe.status === 0;
}

function runStep(name, args, cwd, budgetLeft) {
  const started = Date.now();
  const res = spawnSync('dotnet', args, {
    cwd,
    encoding: 'utf8',
    timeout: Math.max(500, Math.min(STEP_TIMEOUT_MS, budgetLeft)),
  });
  const ms = Date.now() - started;

  // A step that never produced a verdict is NOT a pass. Treating it as one is
  // how a gate silently stops gating: every build times out and the turn ends
  // green. Mark it incomplete so it surfaces as missing coverage instead.
  if (res.error && res.error.code === 'ETIMEDOUT') {
    return { name, ok: true, incomplete: true, ms, note: `${name}: timed out after ${ms} ms` };
  }
  if (res.error) {
    return { name, ok: true, incomplete: true, ms, note: `${name}: could not run (${res.error.message})` };
  }

  const output = `${res.stdout || ''}${res.stderr || ''}`;

  // `dotnet format` ships with the SDK, but a trimmed or very old SDK may not
  // have it. That is missing coverage, not a code defect — do not blame the user.
  if (res.status !== 0 && /is not a dotnet command|Could not execute because|command not found/i.test(output)) {
    return { name, ok: true, incomplete: true, ms, note: `${name}: subcommand unavailable in this SDK` };
  }

  return { name, ok: res.status === 0, ms, output };
}

/** Keep the feedback short — it enters context untruncated. */
function summarize(output, limit = 1200) {
  const lines = (output || '')
    .split('\n')
    .filter((l) => /error|warning|failed|FAIL|✗/i.test(l))
    .filter((l) => !/^\s*$/.test(l));
  const picked = (lines.length ? lines : (output || '').split('\n').filter(Boolean).slice(-12)).slice(0, 20);
  return picked.join('\n').slice(0, limit);
}

run((payload, io) => {
  // Claude Code sets this when a Stop hook already ran for this turn. Without
  // the guard a blocking gate can bounce the model in a loop.
  if (payload.raw.stop_hook_active) return io.allow();

  const cfg = config.load({ cwd: payload.cwd });
  if (!cfg.gateEnabled(RULE_ID)) return io.allow();

  // Draining is also the loop guard: the next Stop sees an empty changeset.
  const state = changeset.drain(payload.sessionId);
  const sources = sourceFiles(state.files);
  if (!sources.length) return io.allow();

  const strict = cfg.profile === 'strict';
  const started = Date.now();
  const left = () => TOTAL_BUDGET_MS - (Date.now() - started);

  if (!haveDotnet()) {
    return io.warn('team-agents: dotnet not found on PATH — quality gate skipped.');
  }

  const projects = dotnet.projectsForFiles(sources.map((s) => s.path));
  if (!projects.length) return io.allow();

  const scoped = projects.slice(0, MAX_PROJECTS);
  const results = [];

  // A gate that quietly skips work reads as "everything passed". Track what was
  // dropped and say so in the report.
  const dropped = [];
  if (projects.length > scoped.length) {
    dropped.push(`${projects.length - scoped.length} project(s) beyond the ${MAX_PROJECTS}-project scope cap`);
  }
  let outOfBudget = false;

  for (const proj of scoped) {
    if (left() <= 500) { outOfBudget = true; break; }
    results.push(runStep(`format ${path.basename(proj)}`, ['format', proj, '--verify-no-changes'], payload.cwd, left()));
    if (left() <= 500) { outOfBudget = true; break; }
    results.push(runStep(`build ${path.basename(proj)}`, ['build', proj, '-warnaserror', '--nologo'], payload.cwd, left()));
  }

  if (strict && !outOfBudget && left() > 500) {
    for (const testProj of dotnet.testProjectsFor(scoped, payload.cwd).slice(0, MAX_PROJECTS)) {
      if (left() <= 500) { outOfBudget = true; break; }
      results.push(runStep(`test ${path.basename(testProj)}`, ['test', testProj, '--nologo'], payload.cwd, left()));
    }
  }

  if (outOfBudget) dropped.push(`remaining steps skipped after the ${TOTAL_BUDGET_MS} ms budget`);
  for (const r of results.filter((r) => r.incomplete)) dropped.push(r.note);

  const failed = results.filter((r) => !r.ok);
  const elapsed = Date.now() - started;

  eventlog.append({
    session_id: payload.sessionId,
    event: 'stop',
    files: sources.map((s) => s.path),
    decision: failed.length ? (strict ? 'block' : 'warn') : 'allow',
    rule_id: RULE_ID,
    duration_ms: elapsed,
    meta: {
      profile: cfg.profile,
      projects: scoped.map((p) => path.basename(p)),
      steps: results.map((r) => ({ name: r.name, ok: r.ok, ms: r.ms, incomplete: !!r.incomplete })),
      dropped,
    },
  });

  // Incomplete coverage is worth saying even when nothing failed, so a green
  // gate is never mistaken for full coverage.
  if (!failed.length) {
    return dropped.length
      ? io.warn(`team-agents quality gate passed, but coverage was incomplete: ${dropped.join('; ')}.`)
      : io.allow();
  }

  const report = [
    `team-agents quality gate failed (${failed.length}/${results.length} step(s), ${elapsed} ms):`,
    ...(dropped.length ? [`Incomplete coverage: ${dropped.join('; ')}.`] : []),
    '',
    ...failed.map((f) => `--- ${f.name} ---\n${summarize(f.output)}`),
  ].join('\n');

  return strict ? io.block(report) : io.addContext(report);
});
