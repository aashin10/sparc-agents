#!/usr/bin/env node
'use strict';

/**
 * instructions:ledger — InstructionsLoaded
 *
 * Records every instruction file the session loaded, how big it was, and what
 * triggered it. This is the debugging tool for "why isn't my rule firing?" —
 * the single most common context question, and one nothing else can answer,
 * because a path-scoped rule that never matched leaves no trace anywhere.
 *
 * It is also the input to `arc-context`: the always-on ledger measured against
 * policies/context-budget.json.
 */

const path = require('path');
const fs = require('fs');
const { run } = require('../lib/hook-io');
const config = require('../lib/config');

const RULE_ID = 'instructions:ledger';

/**
 * The InstructionsLoaded payload shape is not a stable contract, so accept the
 * plausible spellings rather than guessing one and silently recording nothing.
 */
function instructionsFrom(raw) {
  const candidates = [raw.instructions, raw.files, raw.loaded, raw.sources];
  const list = candidates.find((c) => Array.isArray(c)) || [];
  return list
    .map((item) => {
      if (typeof item === 'string') return { path: item, trigger: '', bytes: 0 };
      if (!item || typeof item !== 'object') return null;
      return {
        path: item.path || item.file || item.source || '',
        trigger: item.trigger || item.reason || item.type || '',
        bytes: Number(item.bytes || item.size || 0) || 0,
      };
    })
    .filter((i) => i && i.path);
}

/** Rules with paths: frontmatter are cheap but vanish at compaction. */
function classify(entry) {
  const p = entry.path.replace(/\\/g, '/');
  if (/(^|\/)CLAUDE\.md$/i.test(p)) return 'claude-md';
  if (/(^|\/)MEMORY\.md$/i.test(p)) return 'memory';
  if (/\.claude\/rules\//i.test(p)) return entry.trigger === 'paths' ? 'rule-scoped' : 'rule-always';
  if (/\.claude\/skills\//i.test(p) || /SKILL\.md$/i.test(p)) return 'skill';
  return 'other';
}

run((payload, io) => {
  const cfg = config.load({ cwd: payload.cwd });
  if (!cfg.gateEnabled(RULE_ID)) return io.allow();

  const entries = instructionsFrom(payload.raw);
  if (!entries.length) return io.allow();

  const record = {
    v: 1,
    ts: new Date().toISOString(),
    session_id: payload.sessionId,
    cwd: payload.cwd,
    total_bytes: entries.reduce((a, e) => a + e.bytes, 0),
    entries: entries.map((e) => ({ ...e, kind: classify(e) })),
  };

  try {
    const dir = path.join(config.dataDir(), 'ledger');
    config.ensureDir(dir);
    fs.appendFileSync(
      path.join(dir, `${record.ts.slice(0, 10)}.jsonl`),
      `${JSON.stringify(record)}\n`,
      'utf8'
    );
  } catch {
    return io.allow();
  }

  return io.allow();
});
