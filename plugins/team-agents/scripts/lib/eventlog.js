'use strict';

/**
 * eventlog — append-only, schema-versioned JSONL.
 *
 * One file per day at ${CLAUDE_PLUGIN_DATA}/events/YYYY-MM-DD.jsonl, validated
 * in CI against schemas/event.schema.json. Bump SCHEMA_VERSION on any field
 * change; unversioned event logs rot silently and become unreadable exactly when
 * someone finally wants to query them.
 *
 * Writing is best-effort. Telemetry must never be the reason a hook fails.
 */

const fs = require('fs');
const path = require('path');
const { dataDir, ensureDir } = require('./config');

const SCHEMA_VERSION = 1;

const ALLOWED = new Set([
  'v', 'ts', 'session_id', 'turn', 'event', 'tool', 'agent', 'files',
  'decision', 'rule_id', 'duration_ms', 'cli_version', 'meta',
]);

function eventsDir() {
  return path.join(dataDir(), 'events');
}

function fileForDate(d) {
  const iso = (d || new Date()).toISOString();
  return path.join(eventsDir(), `${iso.slice(0, 10)}.jsonl`);
}

/**
 * @param {object} event  Fields from schemas/event.schema.json. `event` is required.
 * @returns {boolean} whether the line was written
 */
function append(event) {
  if (!event || !event.event) return false;
  try {
    const row = { v: SCHEMA_VERSION, ts: new Date().toISOString() };
    for (const [k, val] of Object.entries(event)) {
      if (ALLOWED.has(k) && val !== undefined) row[k] = val;
    }
    row.v = SCHEMA_VERSION;
    if (!row.cli_version && process.env.CLAUDE_CODE_VERSION) {
      row.cli_version = process.env.CLAUDE_CODE_VERSION;
    }
    ensureDir(eventsDir());
    fs.appendFileSync(fileForDate(), `${JSON.stringify(row)}\n`, 'utf8');
    return true;
  } catch {
    return false;
  }
}

/** Read back one day's events. Malformed lines are skipped, not thrown on. */
function read(date) {
  try {
    return fs
      .readFileSync(fileForDate(date), 'utf8')
      .split('\n')
      .filter(Boolean)
      .map((line) => { try { return JSON.parse(line); } catch { return null; } })
      .filter(Boolean);
  } catch {
    return [];
  }
}

module.exports = { append, read, eventsDir, fileForDate, SCHEMA_VERSION, ALLOWED };
