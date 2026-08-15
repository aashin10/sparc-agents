#!/usr/bin/env node
'use strict';

/**
 * Manifest structure and the locked decisions in docs/ARCHITECTURE.md §13.
 * `claude plugin validate --strict` covers schema conformance; this covers the
 * things that are valid JSON but wrong for this repo.
 */

const fs = require('fs');
const path = require('path');
const { REPO_ROOT, PLUGIN_ROOT, exists, readJson, Report } = require('./lib/ci');

const MARKETPLACE = path.join(REPO_ROOT, '.claude-plugin', 'marketplace.json');
const MANIFEST = path.join(PLUGIN_ROOT, '.claude-plugin', 'plugin.json');
const ALLOWED_IN_METADIR = new Set(['plugin.json', 'SCHEMA-NOTES.md']);

const r = new Report('validate-manifest');

// --- marketplace.json ---------------------------------------------------
if (!exists(MARKETPLACE)) {
  r.error(MARKETPLACE, 'missing');
} else {
  r.checked++;
  const mk = readJson(MARKETPLACE);
  if (mk.name !== 'sparc-agents') {
    r.error(MARKETPLACE, `marketplace name is locked to "sparc-agents", found "${mk.name}"`);
  }
  const entry = (mk.plugins || []).find((p) => p.name === 'team-agents');
  if (!entry) {
    r.error(MARKETPLACE, 'no plugins[] entry named "team-agents"');
  } else {
    const src = typeof entry.source === 'string' ? entry.source : entry.source && entry.source.path;
    if (!src || !src.startsWith('./')) {
      r.error(MARKETPLACE, 'plugin source must be a relative path starting with "./"');
    } else if (!exists(path.join(REPO_ROOT, src))) {
      r.error(MARKETPLACE, `plugin source "${src}" does not exist`);
    }
    if (entry.version) {
      r.warn(MARKETPLACE, 'version pins the plugin and skips updates. During the internal phase it is omitted so the commit SHA is the version.');
    }
  }
}

// --- plugin.json --------------------------------------------------------
if (!exists(MANIFEST)) {
  r.error(MANIFEST, 'missing');
  r.finish();
  return;
}
r.checked++;
const m = readJson(MANIFEST);

if (m.name !== 'team-agents') {
  r.error(MANIFEST, `plugin name is locked to "team-agents", found "${m.name}"`);
}
if (m.version) {
  r.warn(MANIFEST, 'version pins the plugin and skips updates when matched. Omit it until the first stable release.');
}
for (const required of ['description', 'author', 'license']) {
  if (!m[required]) r.warn(MANIFEST, `no "${required}" — it shows in /plugin and costs nothing`);
}

// Only the manifest and the notes file may sit in .claude-plugin/. Anything else
// there is a component that will silently fail to load.
for (const name of fs.readdirSync(path.join(PLUGIN_ROOT, '.claude-plugin'))) {
  r.checked++;
  if (!ALLOWED_IN_METADIR.has(name)) {
    r.error(
      path.join(PLUGIN_ROOT, '.claude-plugin', name),
      'only plugin.json and SCHEMA-NOTES.md belong in .claude-plugin/. Component directories go at the plugin root or they will not load.'
    );
  }
}

// Component paths must be relative, start with "./", and exist.
const PATH_FIELDS = ['skills', 'agents', 'commands', 'workflows', 'outputStyles', 'hooks'];
for (const field of PATH_FIELDS) {
  const val = m[field];
  if (val === undefined) continue;
  const list = Array.isArray(val) ? val : typeof val === 'string' ? [val] : [];
  for (const p of list) {
    r.checked++;
    if (!p.startsWith('./') && p !== '.') {
      r.error(MANIFEST, `${field}: "${p}" must be relative and start with "./"`);
      continue;
    }
    if (!exists(path.join(PLUGIN_ROOT, p))) {
      r.error(MANIFEST, `${field}: "${p}" does not exist`);
    }
  }
}

// `skills` ADDS to the default scan; listing ./skills/ double-loads it.
const skills = Array.isArray(m.skills) ? m.skills : m.skills ? [m.skills] : [];
if (skills.some((p) => /^\.\/skills\/?$/.test(p))) {
  r.error(MANIFEST, '"skills" adds to the default ./skills/ scan — do not list ./skills/ explicitly');
}

// `agents` REPLACES the default; omitting ./agents/ silently unloads the core agents.
if (m.agents !== undefined) {
  const agents = Array.isArray(m.agents) ? m.agents : [m.agents];
  if (!agents.some((p) => /^\.\/agents\/?$/.test(p))) {
    r.error(MANIFEST, '"agents" replaces the default scan — list "./agents/" explicitly or the core agents will not load');
  }
}

// userConfig keys the rest of the plugin reads through config.js.
const uc = m.userConfig || {};
for (const key of ['profile', 'domains', 'track_usage', 'context_budget']) {
  r.checked++;
  if (!uc[key]) r.error(MANIFEST, `userConfig.${key} is missing — scripts/lib/config.js resolves it`);
}

r.finish();
