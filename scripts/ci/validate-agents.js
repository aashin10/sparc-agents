#!/usr/bin/env node
'use strict';

/**
 * Agent frontmatter rules from docs/ARCHITECTURE.md §7.2.
 *
 * The one that matters most: `tools` is a comma-separated scalar, and it is
 * mandatory here. Omitting it grants every tool, which is the opposite of what a
 * read-only reviewer is for — and it fails open, so nothing else catches it.
 */

const path = require('path');
const { PLUGIN_ROOT, walk, frontmatter, Report } = require('./lib/ci');

const DIRS = [
  path.join(PLUGIN_ROOT, 'agents'),
  path.join(PLUGIN_ROOT, 'domains', 'backend', 'agents'),
];

// Plugin-shipped agents may not carry these — they would let a marketplace
// install rewrite the harness's own security posture.
const REJECTED = ['hooks', 'mcpServers', 'permissionMode'];
const SUPPORTED = new Set([
  'name', 'description', 'model', 'effort', 'maxTurns', 'tools',
  'disallowedTools', 'skills', 'memory', 'background', 'isolation',
]);
const WRITE_TOOLS = ['Write', 'Edit', 'MultiEdit', 'NotebookEdit'];

const r = new Report('validate-agents');
const seen = new Map();

for (const dir of DIRS) {
  for (const file of walk(dir, (p) => p.endsWith('.md') && !p.endsWith('README.md'))) {
    r.checked++;
    const fm = frontmatter(file);
    if (!fm.found) { r.error(file, 'no YAML frontmatter'); continue; }

    const k = fm.keys;
    for (const required of ['name', 'description', 'tools']) {
      if (!k[required] || !k[required].value) {
        r.error(file, `missing "${required}"${required === 'tools' ? ' — omitting it grants access to every tool' : ''}`);
      }
    }

    if (k.name) {
      const expected = path.basename(file, '.md');
      if (k.name.value !== expected) {
        r.error(file, `frontmatter name "${k.name.value}" must equal the filename "${expected}" — the name is what gets invoked`);
      }
      if (seen.has(k.name.value)) {
        r.error(file, `duplicate agent name "${k.name.value}", also in ${seen.get(k.name.value)}`);
      } else {
        seen.set(k.name.value, path.basename(file));
      }
      // Domain-owned agents carry the domain in the name, not just the path.
      if (/[/\\]domains[/\\]([^/\\]+)[/\\]/.test(file)) {
        const domain = /[/\\]domains[/\\]([^/\\]+)[/\\]/.exec(file)[1];
        if (!k.name.value.startsWith(`${domain}-`)) {
          r.error(file, `domain agent name must start with "${domain}-" — the path is not enough, the frontmatter name is what gets invoked`);
        }
      }
    }

    if (k.description && k.description.isBlockScalar) {
      r.error(file, 'description must be an inline scalar, not a block scalar');
    }

    if (k.tools) {
      if (k.tools.isSequence) {
        r.error(file, 'tools must be a comma-separated scalar (tools: Read, Grep, Glob), not a YAML sequence');
      }
      const tools = k.tools.value.split(',').map((s) => s.trim()).filter(Boolean);
      const canWrite = tools.some((t) => WRITE_TOOLS.includes(t));
      const looksLikeReviewer = /(-|^)(review|reviewer|audit|scan)/.test(k.name ? k.name.value : '');

      if (looksLikeReviewer && canWrite) {
        r.error(file, 'reviewer agents are read-only — a reviewer that can edit will fix its own findings and destroy the audit trail');
      }
      if (canWrite && (!k.maxTurns || !k.maxTurns.value)) {
        r.error(file, 'write-capable agents must declare maxTurns');
      }
    }

    for (const bad of REJECTED) {
      if (k[bad]) r.error(file, `"${bad}" is rejected for plugin-shipped agents`);
    }
    for (const key of Object.keys(k)) {
      if (!SUPPORTED.has(key) && !REJECTED.includes(key)) {
        r.warn(file, `unrecognized frontmatter key "${key}"`);
      }
    }
    if (k.isolation && k.isolation.value && k.isolation.value.replace(/["']/g, '') !== 'worktree') {
      r.error(file, 'the only valid value for "isolation" is "worktree"');
    }
  }
}

if (r.checked === 0) console.log('  note  no agents yet — see docs/BUILD-PLAN.md phase 4');
r.finish();
