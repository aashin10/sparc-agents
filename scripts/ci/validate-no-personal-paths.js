#!/usr/bin/env node
'use strict';

/**
 * Absolute home paths and secrets, which are the two things that make a plugin
 * work perfectly on the author's machine and nowhere else.
 *
 * Home directories are resolved at runtime through os.homedir() or, better,
 * ${CLAUDE_PLUGIN_DATA}. A literal /Users/<name> in a shipped file is a bug.
 */

const fs = require('fs');
const path = require('path');
const { REPO_ROOT, PLUGIN_ROOT, walk, Report } = require('./lib/ci');

const SCAN = [
  PLUGIN_ROOT,
  path.join(REPO_ROOT, 'scripts'),
  path.join(REPO_ROOT, 'tests'),
];

const SKIP_FILE = /(^|[/\\])(package-lock\.json|\.DS_Store)$/;
const TEXT = /\.(js|mjs|cjs|json|md|sh|ya?ml|txt|ps1)$/;

const PATTERNS = [
  { id: 'macos-home', re: /\/Users\/[A-Za-z0-9._-]+/g, msg: 'absolute macOS home path — use os.homedir() or ${CLAUDE_PLUGIN_DATA}' },
  { id: 'linux-home', re: /\/home\/[A-Za-z0-9._-]+/g, msg: 'absolute Linux home path — use os.homedir() or ${CLAUDE_PLUGIN_DATA}' },
  { id: 'windows-home', re: /[A-Za-z]:\\Users\\[A-Za-z0-9._-]+/g, msg: 'absolute Windows home path' },
  { id: 'plugin-root-write', re: /\$\{CLAUDE_PLUGIN_ROOT\}\/(events|telemetry|changesets|state|cache)\b/g, msg: 'writing under ${CLAUDE_PLUGIN_ROOT} — it is replaced on every update. Write to ${CLAUDE_PLUGIN_DATA}.' },
  { id: 'credential', re: /\b(password|passwd|secret|api[_-]?key|access[_-]?token|client[_-]?secret)\s*[:=]\s*["'][^"']{8,}["']/gi, msg: 'looks like a hard-coded credential' },
  { id: 'aws-key', re: /\bAKIA[0-9A-Z]{16}\b/g, msg: 'AWS access key id' },
  { id: 'private-key', re: /-----BEGIN [A-Z ]*PRIVATE KEY-----/g, msg: 'private key material' },
  { id: 'sql-conn', re: /\b(Server|Data Source)\s*=[^;\n]{1,80};[^\n]*\bPassword\s*=/gi, msg: 'SQL connection string with a password' },
];

// /home/runner is GitHub Actions, not a person; os.homedir() is the correct fix
// being demonstrated, so neither should trip the scanner.
const ALLOW_LINE = [
  /\/home\/runner/,
  /os\.homedir\(\)/,
];

const r = new Report('validate-no-personal-paths');

for (const root of SCAN) {
  for (const file of walk(root, (p) => TEXT.test(p) && !SKIP_FILE.test(p))) {
    r.checked++;
    const lines = fs.readFileSync(file, 'utf8').split(/\r?\n/);
    lines.forEach((line, i) => {
      if (ALLOW_LINE.some((re) => re.test(line))) return;
      for (const p of PATTERNS) {
        p.re.lastIndex = 0;
        const hit = p.re.exec(line);
        if (hit) r.error(file, `line ${i + 1}: ${p.msg} — "${hit[0].slice(0, 60)}"`);
      }
    });
  }
}

r.finish();
