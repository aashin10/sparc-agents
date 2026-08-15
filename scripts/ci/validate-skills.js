#!/usr/bin/env node
'use strict';

/**
 * Skill rules from docs/ARCHITECTURE.md §7.1.
 *
 * Frontmatter name + description is always-on context on every session, whether
 * or not the skill ever fires. That is why descriptions are checked as hard as
 * bodies, and why colliding trigger phrases are an error rather than taste.
 */

const fs = require('fs');
const path = require('path');
const { PLUGIN_ROOT, exists, walk, frontmatter, Report } = require('./lib/ci');

const DIRS = [
  path.join(PLUGIN_ROOT, 'skills'),
  path.join(PLUGIN_ROOT, 'domains', 'backend', 'skills'),
];
const MAX_LINES = 500;

const r = new Report('validate-skills');
const seen = new Map();

for (const dir of DIRS) {
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { continue; }

  for (const e of entries) {
    if (!e.isDirectory()) continue;
    const skillDir = path.join(dir, e.name);
    const md = path.join(skillDir, 'SKILL.md');
    r.checked++;

    if (!exists(md)) { r.error(skillDir, 'no SKILL.md'); continue; }
    if (!fs.statSync(md).size) { r.error(md, 'SKILL.md is empty'); continue; }

    const fm = frontmatter(md);
    if (!fm.found) { r.error(md, 'no YAML frontmatter'); continue; }
    const k = fm.keys;

    for (const required of ['name', 'description']) {
      if (!k[required] || !k[required].value) r.error(md, `missing "${required}"`);
    }

    if (k.name) {
      if (k.name.value !== e.name) {
        r.error(md, `frontmatter name "${k.name.value}" must equal the directory name "${e.name}"`);
      }
      if (seen.has(k.name.value)) {
        r.error(md, `duplicate skill name "${k.name.value}", also in ${seen.get(k.name.value)}`);
      } else {
        seen.set(k.name.value, e.name);
      }
      if (/[/\\]domains[/\\]([^/\\]+)[/\\]/.test(md)) {
        const domain = /[/\\]domains[/\\]([^/\\]+)[/\\]/.exec(md)[1];
        if (!k.name.value.startsWith(`${domain}-`)) {
          r.error(md, `domain skill name must start with "${domain}-" — "team-agents:api-design" becomes ambiguous the moment a second domain exists`);
        }
      }
    }

    if (k.description) {
      if (k.description.isBlockScalar) {
        r.error(md, 'description must be an inline scalar — block scalars (|, |-, >) preserve newlines and break description-keyed rendering');
      }
      // The "when" clause is the routing surface. Without it the skill under-triggers.
      if (!/\bwhen\b/i.test(k.description.value)) {
        r.error(md, 'description must say when to use the skill, not just what it does — that clause is the entire routing surface');
      }
      if (k.description.value.length > 600) {
        r.warn(md, `description is ${k.description.value.length} chars and is paid for on every session`);
      }
    }

    const lines = fm.lineCount;
    if (lines > MAX_LINES) {
      r.error(md, `${lines} lines exceeds the ${MAX_LINES}-line cap — move detail into references/ and point at it from SKILL.md`);
    }

    // Truncation after compaction keeps the START of an invoked skill body, so
    // anything critical at the bottom silently disappears.
    if (lines > 300 && !exists(path.join(skillDir, 'references'))) {
      r.warn(md, 'long skill with no references/ layer — put the critical constraints at the top, they are what survives truncation');
    }
  }
}

// Overlapping first sentences make routing worse, not better.
const firstPhrases = new Map();
for (const dir of DIRS) {
  for (const md of walk(dir, (p) => p.endsWith('SKILL.md'))) {
    const k = frontmatter(md).keys;
    if (!k.description) continue;
    const phrase = k.description.value.toLowerCase().split(/[.;]/)[0].trim();
    if (!phrase) continue;
    if (firstPhrases.has(phrase)) {
      r.error(md, `shares a primary trigger phrase with ${firstPhrases.get(phrase)}`);
    } else {
      firstPhrases.set(phrase, path.basename(path.dirname(md)));
    }
  }
}

if (r.checked === 0) console.log('  note  no skills yet — see docs/BUILD-PLAN.md phase 3');
r.finish();
