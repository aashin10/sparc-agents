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
 */

const fs = require('fs');
const path = require('path');
const { dataDir, ensureDir } = require('./config');

function changesetDir() {
  return path.join(dataDir(), 'changesets');
}

function fileFor(sessionId) {
  const safe = String(sessionId || 'unknown').replace(/[^A-Za-z0-9_-]/g, '_');
  return path.join(changesetDir(), `${safe}.json`);
}

function read(sessionId) {
  try {
    const parsed = JSON.parse(fs.readFileSync(fileFor(sessionId), 'utf8'));
    return {
      session_id: parsed.session_id || sessionId,
      started: parsed.started || new Date().toISOString(),
      files: Array.isArray(parsed.files) ? parsed.files : [],
      tools: parsed.tools && typeof parsed.tools === 'object' ? parsed.tools : {},
    };
  } catch {
    return { session_id: sessionId, started: new Date().toISOString(), files: [], tools: {} };
  }
}

/** Record files touched by a tool. Deduplicates; order of first touch is kept. */
function add(sessionId, files, toolName) {
  try {
    const state = read(sessionId);
    const seen = new Set(state.files);
    for (const f of files || []) {
      if (typeof f === 'string' && f && !seen.has(f)) {
        seen.add(f);
        state.files.push(f);
      }
    }
    if (toolName) state.tools[toolName] = (state.tools[toolName] || 0) + 1;
    state.updated = new Date().toISOString();
    ensureDir(changesetDir());
    fs.writeFileSync(fileFor(sessionId), JSON.stringify(state), 'utf8');
    return state;
  } catch {
    return read(sessionId);
  }
}

/** Read and clear. Call from Stop, once, after the gate has what it needs. */
function drain(sessionId) {
  const state = read(sessionId);
  try { fs.unlinkSync(fileFor(sessionId)); } catch { /* nothing to clear */ }
  return state;
}

module.exports = { add, read, drain, changesetDir, fileFor };
