'use strict';

/**
 * transcript — defensive parser for session transcript `usage` blocks.
 *
 * THE TRANSCRIPT FORMAT IS INTERNAL TO CLAUDE CODE AND CHANGES BETWEEN VERSIONS.
 * Nothing here may throw: every field is optional, every row is wrapped, and the
 * CLI version is recorded on every row so a breaking release shows up as a
 * version column in the data instead of a silent zero.
 *
 * This module is also the normalizing interface that makes OpenTelemetry an
 * adapter swap rather than a rewrite (ARCHITECTURE §8.2). Everything downstream
 * consumes the normalized row shape below, never raw transcript entries.
 *
 *   { ts, session_id, request_id, model, cli_version, source,
 *     input, output, cache_read, cache_write_5m, cache_write_1h, thinking }
 *
 * ## The correctness trap
 *
 * Claude Code writes ONE assistant entry per content block — text, thinking, and
 * each tool_use are separate lines — and every one of them carries the SAME
 * `requestId` and the SAME complete `usage` block. Summing the file naively
 * therefore multiple-counts every request. Measured on a real 591-line
 * transcript: 280 entries carrying usage, 125 distinct requests, output tokens
 * inflated by 155%.
 *
 * So: dedupe by `requestId`. Verified that repeated entries carry identical
 * usage (96 multi-entry groups, 0 with differing values), so taking the first
 * occurrence is correct rather than merely convenient.
 */

const fs = require('fs');
const path = require('path');
const os = require('os');

const SCHEMA_VERSION = 1;

/** Every numeric read goes through this. Missing or junk fields become 0. */
function num(v) {
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? n : 0;
}

/**
 * Normalize one raw transcript entry, or return null if it carries no usage.
 * Wrapped by the caller; still written not to throw on its own.
 */
function normalizeEntry(entry) {
  if (!entry || entry.type !== 'assistant') return null;
  const message = entry.message;
  if (!message || typeof message !== 'object') return null;
  const usage = message.usage;
  if (!usage || typeof usage !== 'object') return null;

  // Cache creation is reported both as a flat total and, on newer versions, as a
  // per-TTL breakdown. Prefer the breakdown (the TTLs are priced differently);
  // fall back to charging the flat total at the 5m rate, which is the cheaper
  // of the two — an under-estimate is safer than inventing spend.
  const creation = usage.cache_creation && typeof usage.cache_creation === 'object' ? usage.cache_creation : {};
  const w1h = num(creation.ephemeral_1h_input_tokens);
  const w5m = num(creation.ephemeral_5m_input_tokens);
  const flatCreate = num(usage.cache_creation_input_tokens);
  const haveBreakdown = w1h > 0 || w5m > 0;

  const details = usage.output_tokens_details && typeof usage.output_tokens_details === 'object'
    ? usage.output_tokens_details
    : {};

  return {
    v: SCHEMA_VERSION,
    ts: typeof entry.timestamp === 'string' ? entry.timestamp : '',
    session_id: entry.sessionId || '',
    request_id: entry.requestId || message.id || '',
    model: message.model || 'unknown',
    cli_version: entry.version || '',
    // isSidechain marks subagent traffic. Keeping main and subagent separable
    // matters because subagent spend is easy to misattribute (ARCHITECTURE §8.3).
    source: entry.isSidechain ? 'subagent' : 'main',
    input: num(usage.input_tokens),
    output: num(usage.output_tokens),
    cache_read: num(usage.cache_read_input_tokens),
    cache_write_5m: haveBreakdown ? w5m : flatCreate,
    cache_write_1h: haveBreakdown ? w1h : 0,
    thinking: num(details.thinking_tokens),
    cwd: entry.cwd || '',
    git_branch: entry.gitBranch || '',
  };
}

/**
 * Parse a transcript file into deduped, normalized rows.
 *
 * @returns {{rows: Array, stats: {lines: number, parsed: number, withUsage: number,
 *            deduped: number, skipped: number, versions: string[]}}}
 */
function parseFile(file) {
  const stats = { lines: 0, parsed: 0, withUsage: 0, deduped: 0, skipped: 0, versions: [] };
  const rows = [];
  const seen = new Set();
  const versions = new Set();

  let text = '';
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch {
    return { rows, stats };
  }

  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    stats.lines++;

    let entry;
    try {
      entry = JSON.parse(line);
    } catch {
      stats.skipped++;      // a torn final line while the session is live is normal
      continue;
    }
    stats.parsed++;

    let row = null;
    try {
      row = normalizeEntry(entry);
    } catch {
      stats.skipped++;      // unknown future shape — count it, never crash on it
      continue;
    }
    if (!row) continue;
    stats.withUsage++;

    if (row.cli_version) versions.add(row.cli_version);

    // The dedup that makes the numbers real. See the module header.
    const key = row.request_id;
    if (key && seen.has(key)) {
      stats.deduped++;
      continue;
    }
    if (key) seen.add(key);
    rows.push(row);
  }

  stats.versions = [...versions];
  return { rows, stats };
}

/** Default location of Claude Code session transcripts. */
function transcriptsDir(projectKey) {
  const base = path.join(os.homedir(), '.claude', 'projects');
  return projectKey ? path.join(base, projectKey) : base;
}

/** Turn a project path into the directory key Claude Code uses. */
function projectKeyFor(cwd) {
  return String(cwd || process.cwd()).replace(/[/\\.]/g, '-');
}

/** All transcript files under a project, newest first. */
function listTranscripts(projectKey) {
  const dir = transcriptsDir(projectKey);
  try {
    return fs
      .readdirSync(dir)
      .filter((f) => f.endsWith('.jsonl'))
      .map((f) => path.join(dir, f))
      .map((f) => ({ file: f, mtime: (() => { try { return fs.statSync(f).mtimeMs; } catch { return 0; } })() }))
      .sort((a, b) => b.mtime - a.mtime)
      .map((e) => e.file);
  } catch {
    return [];
  }
}

const ZERO = () => ({
  input: 0, output: 0, cache_read: 0, cache_write_5m: 0, cache_write_1h: 0, thinking: 0, requests: 0,
});

function addInto(acc, row) {
  acc.input += row.input;
  acc.output += row.output;
  acc.cache_read += row.cache_read;
  acc.cache_write_5m += row.cache_write_5m;
  acc.cache_write_1h += row.cache_write_1h;
  acc.thinking += row.thinking;
  acc.requests += 1;
  return acc;
}

function totalTokens(acc) {
  return acc.input + acc.output + acc.cache_read + acc.cache_write_5m + acc.cache_write_1h;
}

/**
 * Cost for one bucket under a rate card.
 * Unpriced models contribute 0 and are named by the caller, never silently zeroed.
 */
function costOf(acc, rate) {
  if (!rate) return 0;
  const per = (tokens, price) => (tokens / 1e6) * (Number(price) || 0);
  return (
    per(acc.input, rate.input) +
    per(acc.output, rate.output) +
    per(acc.cache_read, rate.cache_read) +
    per(acc.cache_write_5m, rate.cache_write_5m) +
    per(acc.cache_write_1h, rate.cache_write_1h)
  );
}

/**
 * Roll rows up by type, source, and model.
 * @param {Array} rows
 * @param {object} pricing policies/pricing.json contents
 */
function summarize(rows, pricing) {
  const models = (pricing && pricing.models) || {};
  const out = {
    total: ZERO(),
    bySource: {},
    byModel: {},
    cost: 0,
    unpricedModels: [],
    sessions: new Set(),
    cliVersions: new Set(),
  };

  for (const row of rows || []) {
    addInto(out.total, row);
    out.bySource[row.source] = addInto(out.bySource[row.source] || ZERO(), row);
    out.byModel[row.model] = addInto(out.byModel[row.model] || ZERO(), row);
    if (row.session_id) out.sessions.add(row.session_id);
    if (row.cli_version) out.cliVersions.add(row.cli_version);
  }

  for (const [model, acc] of Object.entries(out.byModel)) {
    const rate = models[model];
    if (!rate) {
      if (totalTokens(acc) > 0) out.unpricedModels.push(model);
      acc.cost = 0;
      continue;
    }
    acc.cost = costOf(acc, rate);
    out.cost += acc.cost;
  }

  // Apportion cost across sources by each source's share of priced spend.
  for (const [source, acc] of Object.entries(out.bySource)) {
    acc.cost = 0;
    for (const row of rows) {
      if (row.source !== source) continue;
      const rate = models[row.model];
      if (rate) acc.cost += costOf(addInto(ZERO(), row), rate);
    }
  }

  out.sessions = [...out.sessions];
  out.cliVersions = [...out.cliVersions];
  return out;
}

module.exports = {
  parseFile, summarize, normalizeEntry, listTranscripts, transcriptsDir,
  projectKeyFor, totalTokens, costOf, ZERO, SCHEMA_VERSION,
};
