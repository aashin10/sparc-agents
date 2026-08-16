'use strict';

/**
 * changeset — what this turn touched.
 *
 * PostToolUse accumulates (cheap, non-blocking, never runs tooling). Stop drains
 * and acts on the result. Keeping the expensive work on Stop is what lets the
 * quality gate scope itself to the projects that actually changed instead of
 * building the whole solution on every turn.
 *
 * State lives under ${CLAUDE_PLUGIN_DATA}, keyed by session.
 *
 * ## Why append-only, not a JSON blob
 *
 * Claude Code runs tools in parallel, and every one of them fires its own
 * PostToolUse hook — as a separate OS process. A read-modify-write of a single
 * JSON file therefore races: several processes read the same state, each adds
 * its own file, and the last writer wins. Measured with 12 concurrent edits
 * against the previous implementation: 4 were silently lost.
 *
 * That is the worst possible failure for this module. A dropped path means the
 * Stop gate never builds that project, so a broken build reports success — the
 * gate looks like it ran and it did nothing.
 *
 * Appending one line per call fixes it: each writer opens with O_APPEND and does
 * a single small write, so writers never overwrite each other's records.
 */

const fs = require('fs');
const path = require('path');
const { dataDir, ensureDir } = require('./config');

function changesetDir() {
  return path.join(dataDir(), 'changesets');
}

function fileFor(sessionId) {
  const safe = String(sessionId || 'unknown').replace(/[^A-Za-z0-9_-]/g, '_');
  return path.join(changesetDir(), `${safe}.jsonl`);
}

/**
 * Fold the append log into the aggregate the gate consumes.
 * Order of first touch is preserved; duplicates collapse.
 */
function read(sessionId) {
  const state = { session_id: sessionId, started: '', files: [], tools: {} };
  let text = '';
  try {
    text = fs.readFileSync(fileFor(sessionId), 'utf8');
  } catch {
    return state;
  }

  const seen = new Set();
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    let rec;
    try {
      rec = JSON.parse(line);
    } catch {
      continue; // a torn line must not lose the rest of the log
    }
    if (!state.started && rec.ts) state.started = rec.ts;
    if (rec.ts) state.updated = rec.ts;
    if (rec.tool) state.tools[rec.tool] = (state.tools[rec.tool] || 0) + 1;
    for (const f of Array.isArray(rec.files) ? rec.files : []) {
      if (typeof f === 'string' && f && !seen.has(f)) {
        seen.add(f);
        state.files.push(f);
      }
    }
  }
  return state;
}

/**
 * Record files touched by a tool. One append per call — never a read-modify-write.
 * Best-effort: accumulation must never be the reason a tool call fails.
 */
function add(sessionId, files, toolName) {
  const list = (files || []).filter((f) => typeof f === 'string' && f);
  if (!list.length) return read(sessionId);
  try {
    ensureDir(changesetDir());
    const rec = { ts: new Date().toISOString(), tool: toolName || '', files: list };
    fs.appendFileSync(fileFor(sessionId), `${JSON.stringify(rec)}\n`, 'utf8');
  } catch {
    /* accumulation is best-effort */
  }
  return read(sessionId);
}

/** Read and clear. Call from Stop, once, after the gate has what it needs. */
function drain(sessionId) {
  const state = read(sessionId);
  try { fs.unlinkSync(fileFor(sessionId)); } catch { /* nothing to clear */ }
  return state;
}

module.exports = { add, read, drain, changesetDir, fileFor };
