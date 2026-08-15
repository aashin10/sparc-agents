#!/usr/bin/env node
'use strict';

/**
 * Fail the build when the plugin's always-on context cost exceeds the ceiling in
 * policies/context-budget.json.
 *
 * Always-on cost is paid on every session by every teammate whether or not a
 * single skill fires, and it only ever goes up by accident. When this fails, the
 * fix is a shorter description or disable-model-invocation: true — not a higher
 * ceiling.
 *
 *   node scripts/ci/check-token-budget.js
 *   node scripts/ci/check-token-budget.js --input saved-output.txt
 *   node scripts/ci/check-token-budget.js --require   # fail if the CLI is absent
 */

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { PLUGIN_ROOT, readJson, exists } = require('./lib/ci');

const POLICY = path.join(PLUGIN_ROOT, 'policies', 'context-budget.json');
const args = process.argv.slice(2);
const inputIdx = args.indexOf('--input');
const required = args.includes('--require');

const policy = exists(POLICY) ? readJson(POLICY) : { ceiling_tokens: 2500, warn_at_tokens: 2000 };
const ceiling = policy.ceiling_tokens ?? 2500;
const warnAt = policy.warn_at_tokens ?? Math.floor(ceiling * 0.8);

let output;
if (inputIdx !== -1 && args[inputIdx + 1]) {
  output = fs.readFileSync(args[inputIdx + 1], 'utf8');
} else {
  const res = spawnSync('claude', ['plugin', 'details', 'team-agents'], { encoding: 'utf8', timeout: 60000 });
  if (res.error || res.status !== 0) {
    const why = res.error ? res.error.message : (res.stderr || '').trim();
    if (required) {
      console.error(`FAIL  check-token-budget — could not run \`claude plugin details team-agents\`: ${why}`);
      process.exit(1);
    }
    console.log(`skip  check-token-budget — Claude Code CLI unavailable (${why}).`);
    console.log('      Run it locally after every content commit; the number only goes up by accident.');
    process.exit(0);
  }
  output = res.stdout || '';
}

// The exact rendering of `claude plugin details` is not a stable contract, so
// parse loosely and say so rather than claiming a precision we do not have.
const ANSI = new RegExp(String.fromCharCode(27) + '\\[[0-9;]*m', 'g');
const clean = output.replace(ANSI, '');

let alwaysOn = null;
for (const line of clean.split(/\r?\n/)) {
  if (!/always[- ]?on/i.test(line)) continue;
  const n = /([\d][\d,._]*)\s*(k)?\s*(tokens?)?/i.exec(line.replace(/always[- ]?on/i, ''));
  if (!n) continue;
  let v = Number(n[1].replace(/[,_]/g, ''));
  if (n[2]) v *= 1000;
  if (Number.isFinite(v)) { alwaysOn = v; break; }
}

if (alwaysOn === null) {
  console.log('skip  check-token-budget — no always-on token count found in the CLI output.');
  console.log('      If the output format changed, fix the parser here and append a note to');
  console.log('      plugins/team-agents/.claude-plugin/SCHEMA-NOTES.md.');
  process.exit(required ? 1 : 0);
}

const pct = ((alwaysOn / ceiling) * 100).toFixed(0);
if (alwaysOn > ceiling) {
  console.error(`FAIL  check-token-budget — always-on cost ${alwaysOn} tokens exceeds the ${ceiling} ceiling (${pct}%).`);
  console.error('      Shorten a description or set disable-model-invocation: true. Do not raise the ceiling.');
  process.exit(1);
}
if (alwaysOn > warnAt) {
  console.warn(`warn  check-token-budget — always-on cost ${alwaysOn} tokens is ${pct}% of the ${ceiling} ceiling.`);
} else {
  console.log(`ok    check-token-budget — always-on cost ${alwaysOn} tokens, ${pct}% of the ${ceiling} ceiling.`);
}
