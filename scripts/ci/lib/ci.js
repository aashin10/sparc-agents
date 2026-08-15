'use strict';

/**
 * Shared helpers for the plugin's own CI. Zero dependencies on purpose — these
 * run on a clean clone before anything is installed.
 */

const fs = require('fs');
const path = require('path');

const REPO_ROOT = path.resolve(__dirname, '..', '..', '..');
const PLUGIN_ROOT = path.join(REPO_ROOT, 'plugins', 'team-agents');

function exists(p) {
  try { fs.accessSync(p); return true; } catch { return false; }
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

/** Recursively list files under dir. Returns [] when dir is missing. */
function walk(dir, filter) {
  const out = [];
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return out; }
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (e.name === 'node_modules' || e.name === '.git') continue;
      out.push(...walk(full, filter));
    } else if (!filter || filter(full, e.name)) {
      out.push(full);
    }
  }
  return out;
}

/**
 * Split YAML frontmatter off a markdown file.
 *
 * Deliberately not a YAML parser. It only needs to answer the questions the
 * validators ask — which keys exist, whether a value is an inline scalar, a
 * block scalar, or a sequence — and a real parser would normalize away exactly
 * the distinctions being checked.
 */
function frontmatter(file) {
  const text = fs.readFileSync(file, 'utf8');
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(text);
  if (!m) return { found: false, keys: {}, body: text, raw: '' };

  const raw = m[1];
  const body = text.slice(m[0].length);
  const keys = {};
  const lines = raw.split(/\r?\n/);

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const km = /^([A-Za-z0-9_-]+):[ \t]*(.*)$/.exec(line);
    if (!km) continue;
    const key = km[1];
    const inline = km[2];

    // Collect the indented continuation block belonging to this key.
    const cont = [];
    for (let j = i + 1; j < lines.length; j++) {
      if (/^[A-Za-z0-9_-]+:/.test(lines[j])) break;
      if (lines[j].trim() === '') { cont.push(lines[j]); continue; }
      if (!/^\s/.test(lines[j])) break;
      cont.push(lines[j]);
    }

    const isBlockScalar = /^[|>][+-]?\s*$/.test(inline.trim());
    const isFlowSequence = /^\[.*\]$/.test(inline.trim());
    const isBlockSequence = inline.trim() === '' && cont.some((l) => /^\s*-\s+/.test(l));

    keys[key] = {
      line: i + 1,
      inline,
      value: isBlockScalar ? cont.join('\n').trim() : inline.trim(),
      isBlockScalar,
      isSequence: isFlowSequence || isBlockSequence,
    };
  }

  return { found: true, keys, body, raw, lineCount: text.split(/\r?\n/).length };
}

function rel(p) {
  return path.relative(REPO_ROOT, p) || p;
}

/** Collects problems and decides the exit code. */
class Report {
  constructor(name) {
    this.name = name;
    this.errors = [];
    this.warnings = [];
    this.checked = 0;
  }
  error(file, msg) { this.errors.push({ file: rel(file), msg }); }
  warn(file, msg) { this.warnings.push({ file: rel(file), msg }); }
  finish() {
    const pad = '  ';
    for (const w of this.warnings) console.warn(`${pad}warn  ${w.file}: ${w.msg}`);
    for (const e of this.errors) console.error(`${pad}FAIL  ${e.file}: ${e.msg}`);
    const status = this.errors.length ? 'FAIL' : 'ok';
    const counts = `${this.checked} checked, ${this.errors.length} error(s), ${this.warnings.length} warning(s)`;
    console.log(`${status.padEnd(5)} ${this.name} — ${counts}`);
    if (this.errors.length) process.exitCode = 1;
    return this.errors.length === 0;
  }
}

module.exports = { REPO_ROOT, PLUGIN_ROOT, exists, readJson, walk, frontmatter, rel, Report };
