#!/usr/bin/env node
'use strict';

/**
 * telemetry:session-rollup — SessionEnd
 *
 * Drains the session transcript into ${CLAUDE_PLUGIN_DATA}/telemetry/ so spend
 * survives the session that produced it. Source A of ARCHITECTURE §8.2 — the
 * zero-infrastructure one that works offline and exists today. OpenTelemetry
 * becomes an adapter behind transcript.js rather than a rewrite.
 *
 * Runs after the session is over, so it has no latency budget to respect — but
 * it must never throw, because a telemetry failure that surfaces as a hook error
 * teaches people to turn the plugin off.
 */

const fs = require('fs');
const path = require('path');
const { run } = require('../lib/hook-io');
const config = require('../lib/config');
const eventlog = require('../lib/eventlog');
const transcript = require('../lib/transcript');

const RULE_ID = 'telemetry:session-rollup';

run((payload, io) => {
  const cfg = config.load({ cwd: payload.cwd });
  if (!cfg.track_usage) return io.allow();
  if (!payload.transcriptPath) return io.allow();

  const started = Date.now();
  const { rows, stats } = transcript.parseFile(payload.transcriptPath);
  if (!rows.length) return io.allow();

  // Only this session's rows — a transcript file can be resumed and re-read.
  const sessionId = payload.sessionId;
  const mine = sessionId ? rows.filter((r) => !r.session_id || r.session_id === sessionId) : rows;

  const dir = path.join(config.dataDir(), 'telemetry');
  const file = path.join(dir, `${new Date().toISOString().slice(0, 10)}.jsonl`);

  let written = 0;
  try {
    config.ensureDir(dir);
    // Re-running a rollup for the same session must not double the numbers.
    const already = new Set();
    try {
      for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
        if (!line.trim()) continue;
        try { const r = JSON.parse(line); if (r.request_id) already.add(r.request_id); } catch { /* skip */ }
      }
    } catch { /* first rollup of the day */ }

    const fresh = mine.filter((r) => !r.request_id || !already.has(r.request_id));
    if (fresh.length) {
      fs.appendFileSync(file, fresh.map((r) => JSON.stringify(r)).join('\n') + '\n', 'utf8');
    }
    written = fresh.length;
  } catch {
    return io.allow(); // telemetry is never worth failing a session over
  }

  eventlog.append({
    session_id: sessionId,
    event: 'session_end',
    decision: 'allow',
    rule_id: RULE_ID,
    duration_ms: Date.now() - started,
    meta: {
      reason: payload.reason,
      requests: written,
      deduped: stats.deduped,
      unparseable: stats.skipped,
      cli_versions: stats.versions,
    },
  });

  return io.allow();
});
