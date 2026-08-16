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


/**
 * parseTools — per-tool and per-MCP-server context accounting.
 *
 * ## What this can and cannot know
 *
 * `message.usage` is per-REQUEST. There is no per-tool or per-server token field
 * anywhere in the transcript — verified against a real session: the only
 * tool-adjacent key is `server_tool_use`, which counts Anthropic server-side
 * web_search/web_fetch requests, not MCP. So exact billed tokens per MCP server
 * cannot be derived, and any tool claiming otherwise is guessing.
 *
 * What IS derivable, and is what this returns:
 *   - call counts per tool, and per MCP server via the `mcp__<server>__<tool>`
 *     naming convention
 *   - the size of each tool RESULT, i.e. how much context that tool pushed into
 *     the window (matched tool_use_id -> tool_result)
 *
 * ## Why "amplified" is the number that matters
 *
 * A tool result is not paid for once. It lands in the conversation prefix and is
 * then re-read on every subsequent request for the rest of the session — at
 * cache-read rates, but re-read all the same. A 40k-token result returned early
 * in a long session is charged far more than 40k tokens.
 *
 * So each result is weighted by the number of requests that followed it. That is
 * an estimate (compaction can evict, a cache miss re-bills at full input rate),
 * but it is directionally right and it is the number that changes decisions
 * about which tools and which MCP servers are worth keeping connected.
 */
function parseTools(file) {
  const tools = {};
  const bump = (name) => (tools[name] = tools[name] || {
    name, calls: 0, results: 0, result_bytes: 0, errors: 0, amplified_tokens: 0,
  });

  let text = '';
  try { text = fs.readFileSync(file, 'utf8'); } catch { return { tools: {}, servers: {}, requests: 0 }; }

  const entries = [];
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    try { entries.push(JSON.parse(line)); } catch { /* torn line */ }
  }

  // Request ordinal per entry, so a result can be weighted by what follows it.
  const seenReq = new Set();
  let ordinal = 0;
  const ordinalAt = [];
  for (const e of entries) {
    if (e && e.type === 'assistant' && e.requestId && !seenReq.has(e.requestId)) {
      seenReq.add(e.requestId);
      ordinal++;
    }
    ordinalAt.push(ordinal);
  }
  const totalRequests = ordinal;

  const idToName = new Map();
  entries.forEach((e, i) => {
    if (!e || typeof e !== 'object') return;
    const content = e.message && Array.isArray(e.message.content) ? e.message.content : [];

    if (e.type === 'assistant') {
      for (const b of content) {
        if (b && b.type === 'tool_use' && b.name) {
          bump(b.name).calls++;
          if (b.id) idToName.set(b.id, b.name);
        }
      }
      return;
    }

    if (e.type !== 'user') return;
    for (const b of content) {
      if (!b || b.type !== 'tool_result') continue;
      const name = idToName.get(b.tool_use_id);
      if (!name) continue;
      const t = bump(name);
      const payload = typeof b.content === 'string' ? b.content : JSON.stringify(b.content || '');
      const bytes = Buffer.byteLength(payload);
      t.results++;
      t.result_bytes += bytes;
      if (b.is_error) t.errors++;
      // ~4 chars/token, weighted by the requests that still had to carry it.
      const remaining = Math.max(0, totalRequests - (ordinalAt[i] || 0));
      t.amplified_tokens += Math.round(bytes / 4) * remaining;
    }
  });

  for (const t of Object.values(tools)) t.result_tokens = Math.round(t.result_bytes / 4);

  // Group MCP tools by server: mcp__<server>__<tool>
  const servers = {};
  for (const t of Object.values(tools)) {
    const m = /^mcp__([^_]+(?:_[^_]+)*?)__(.+)$/.exec(t.name);
    if (!m) continue;
    const server = m[1];
    const s = servers[server] = servers[server] || {
      server, calls: 0, result_tokens: 0, amplified_tokens: 0, errors: 0, tools: [],
    };
    s.calls += t.calls;
    s.result_tokens += t.result_tokens;
    s.amplified_tokens += t.amplified_tokens;
    s.errors += t.errors;
    s.tools.push(m[2]);
  }

  return { tools, servers, requests: totalRequests };
}

module.exports = {
  parseFile, parseTools, summarize, normalizeEntry, listTranscripts, transcriptsDir,
  projectKeyFor, totalTokens, costOf, ZERO, SCHEMA_VERSION,
};
