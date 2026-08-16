#!/usr/bin/env node
'use strict';

/**
 * Runs `claude plugin validate --strict` and applies one documented exception.
 *
 * Why this wrapper exists
 * -----------------------
 * `--strict` is worth having: it promotes unrecognized-field warnings to errors,
 * which is what catches a typo'd manifest key before it silently unloads half
 * the plugin.
 *
 * But it also fails on `version: No version specified`, and omitting `version`
 * is locked decision ARCHITECTURE §13.2 — with no version, Claude Code resolves
 * the version from the git commit SHA, so teammates tracking main get updates on
 * every push. Pinning a version instead means content ships only when someone
 * remembers to bump it. That was verified empirically, not assumed: with a
 * pinned version, a changed skill did not reach the cache and the CLI reported
 * "already at the latest version".
 *
 * So: fail on every error and every unexpected warning, tolerate exactly the
 * version warning, and re-check that it is still the only one on every run. If
 * the team later adopts a release cadence, delete TOLERATED and this becomes a
 * plain --strict run.
 */

const path = require('path');
const { spawnSync } = require('child_process');
const { REPO_ROOT, PLUGIN_ROOT, rel } = require('./lib/ci');

const TOLERATED = [
  {
    // The marketplace run prefixes its findings ("plugins[0] plugin.json → …"),
    // so match the field name wherever it appears rather than anchoring to start.
    re: /(^|→\s*)version:\s*No version specified/i,
    why: 'ARCHITECTURE §13.2 — version is omitted so the commit SHA is the version',
  },
];

const TARGETS = [
  { label: 'plugin', path: PLUGIN_ROOT },
  { label: 'marketplace', path: path.join(REPO_ROOT, '.claude-plugin', 'marketplace.json') },
];

const required = process.argv.includes('--require');

/** Split the CLI's human-readable output into classified findings. */
function parse(output) {
  const findings = [];
  let section = null;
  for (const raw of output.split(/\r?\n/)) {
    const line = raw.trim();
    const header = /Found\s+\d+\s+(error|warning)/i.exec(line);
    if (header) {
      section = header[1].toLowerCase();
      continue;
    }
    if (line.startsWith('❯')) {
      findings.push({ kind: section || 'error', text: line.replace(/^❯\s*/, '') });
    }
  }
  return findings;
}

let failures = 0;
let ran = 0;

for (const target of TARGETS) {
  const res = spawnSync('claude', ['plugin', 'validate', target.path, '--strict'], {
    encoding: 'utf8',
    timeout: 60000,
  });

  if (res.error) {
    const why = res.error.message;
    if (required) {
      console.error(`FAIL  validate-cli-strict — Claude Code CLI unavailable: ${why}`);
      process.exit(1);
    }
    console.log(`skip  validate-cli-strict — Claude Code CLI unavailable (${why}).`);
    process.exit(0);
  }

  ran++;
  const findings = parse(`${res.stdout || ''}${res.stderr || ''}`);
  const problems = [];
  const excused = [];

  for (const f of findings) {
    const ok = f.kind === 'warning' && TOLERATED.find((t) => t.re.test(f.text));
    if (ok) excused.push({ ...f, why: ok.why });
    else problems.push(f);
  }

  for (const e of excused) console.log(`  allow ${target.label}: ${e.text}\n        ${e.why}`);
  for (const p of problems) console.error(`  ${p.kind === 'warning' ? 'warn ' : 'FAIL '} ${target.label}: ${p.text}`);

  if (problems.length) {
    failures += problems.length;
    continue;
  }

  // Exit code 1 with nothing but excused warnings is the expected shape.
  // A non-zero exit we cannot explain means the output format moved.
  if (res.status !== 0 && !excused.length) {
    console.error(`  FAIL  ${target.label}: validate exited ${res.status} with no parseable finding.`);
    console.error('        The CLI output format may have changed — fix the parser here and');
    console.error('        append a note to plugins/team-agents/.claude-plugin/SCHEMA-NOTES.md.');
    failures++;
  }
}

console.log(
  `${failures ? 'FAIL ' : 'ok   '} validate-cli-strict — ${ran} target(s), ${failures} problem(s)` +
  `${failures ? '' : ', 1 documented exception'}`
);
process.exit(failures ? 1 : 0);
