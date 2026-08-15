#!/usr/bin/env node
'use strict';

/**
 * Feed every fixture to every hook registered for its event and assert the exit
 * code and output shape.
 *
 * Hooks are the part that breaks silently and the part users blame the plugin
 * for. Nothing else in CI actually runs them.
 *
 * Writes go to a throwaway CLAUDE_PLUGIN_DATA so a smoke run never touches real
 * telemetry.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { REPO_ROOT, PLUGIN_ROOT, readJson, walk, rel } = require('./lib/ci');

const HOOKS_DIR = path.join(PLUGIN_ROOT, 'hooks');
const FIXTURES = path.join(REPO_ROOT, 'tests', 'fixtures', 'hook-events');

const PRE_TOOL_BUDGET_MS = 150;   // the design budget from ARCHITECTURE §7.3
const HARD_FAIL_MS = 500;         // slow enough that it is a bug, not a loaded runner

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'team-agents-smoke-'));

let failures = 0;
let runs = 0;
const slow = [];

function expand(str) {
  return String(str)
    .replace(/\$\{CLAUDE_PLUGIN_ROOT\}/g, PLUGIN_ROOT)
    .replace(/\$\{CLAUDE_PROJECT_DIR\}/g, REPO_ROOT);
}

const fixtures = walk(FIXTURES, (p) => p.endsWith('.json')).map((f) => ({ file: f, payload: readJson(f) }));

function runOne(label, handler, fixture) {
  runs++;
  const usesArgs = Array.isArray(handler.args);
  const cmd = expand(handler.command);
  const args = usesArgs ? handler.args.map(expand) : [];

  const started = process.hrtime.bigint();
  const res = spawnSync(cmd, args, {
    input: JSON.stringify(fixture.payload),
    encoding: 'utf8',
    shell: !usesArgs,
    timeout: 10000,
    env: {
      ...process.env,
      CLAUDE_PLUGIN_ROOT: PLUGIN_ROOT,
      CLAUDE_PLUGIN_DATA: dataDir,
      CLAUDE_PROJECT_DIR: REPO_ROOT,
    },
  });
  const ms = Number(process.hrtime.bigint() - started) / 1e6;

  const name = `${label} <- ${path.basename(fixture.file)}`;
  const problems = [];

  if (res.error) problems.push(`spawn failed: ${res.error.message}`);
  if (res.status === null && !res.error) problems.push('timed out');

  // 0 = allow, 2 = block. Anything else is a crash the user will see as noise.
  if (res.status !== null && res.status !== 0 && res.status !== 2) {
    problems.push(`exit ${res.status} (expected 0 or 2)\n      stderr: ${(res.stderr || '').trim().split('\n')[0]}`);
  }

  // Plain stdout goes to the debug log only. If a hook writes stdout at all it
  // must be the JSON control envelope, or its intent is silently dropped.
  const out = (res.stdout || '').trim();
  if (out) {
    try {
      const parsed = JSON.parse(out);
      if (parsed.hookSpecificOutput && !parsed.hookSpecificOutput.hookEventName) {
        problems.push('hookSpecificOutput without hookEventName');
      }
    } catch {
      problems.push(`stdout is not valid JSON, so it will never reach context: ${out.slice(0, 120)}`);
    }
  }

  if (res.status === 2 && !(res.stderr || '').trim()) {
    problems.push('exit 2 with empty stderr — the model gets no reason for the block');
  }

  if (fixture.payload.hook_event_name === 'PreToolUse') {
    if (ms > HARD_FAIL_MS) problems.push(`${ms.toFixed(0)} ms — far over the ${PRE_TOOL_BUDGET_MS} ms PreToolUse budget`);
    else if (ms > PRE_TOOL_BUDGET_MS) slow.push(`${name}: ${ms.toFixed(0)} ms (budget ${PRE_TOOL_BUDGET_MS} ms)`);
  }

  if (problems.length) {
    failures++;
    console.error(`  FAIL  ${name}`);
    for (const p of problems) console.error(`        ${p}`);
  } else {
    console.log(`  ok    ${name}  ${ms.toFixed(0)} ms`);
  }
}

const configs = walk(HOOKS_DIR, (p) => p.endsWith('.json'));
if (!configs.length) {
  console.error('FAIL  smoke-hooks — no hook configuration found');
  process.exit(1);
}

for (const file of configs) {
  console.log(`\n${rel(file)}`);
  const cfg = readJson(file);
  for (const [event, groups] of Object.entries(cfg.hooks || {})) {
    const matching = fixtures.filter((f) => f.payload.hook_event_name === event);
    if (!matching.length) {
      failures++;
      console.error(`  FAIL  ${event}: no fixture. Every hook ships with one in the same commit.`);
      continue;
    }
    for (const group of groups) {
      for (const handler of group.hooks || []) {
        if (handler.type !== 'command') {
          console.log(`  skip  ${group.id} (${handler.type} handler — not exercised locally)`);
          continue;
        }
        for (const fixture of matching) runOne(`${event} ${group.id}`, handler, fixture);
      }
    }
  }
}

fs.rmSync(dataDir, { recursive: true, force: true });

console.log('');
for (const s of slow) console.warn(`  warn  ${s}`);
console.log(`${failures ? 'FAIL ' : 'ok   '} smoke-hooks — ${runs} run(s), ${failures} failure(s)`);
process.exit(failures ? 1 : 0);
