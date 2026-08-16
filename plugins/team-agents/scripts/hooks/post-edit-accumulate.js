#!/usr/bin/env node
'use strict';

/**
 * post:edit-accumulate — PostToolUse on Edit|Write|MultiEdit|NotebookEdit
 *
 * Records what changed and nothing else. Never runs tooling here: PostToolUse
 * fires after every single edit, and anything heavier than a file append turns
 * a ten-edit turn into a ten-build turn. The expensive work happens once, on
 * Stop, scoped to what this accumulated.
 */

const { run } = require('../lib/hook-io');
const config = require('../lib/config');
const changeset = require('../lib/changeset');
const { classify } = require('../lib/classify');

const RULE_ID = 'post:edit-accumulate';

run((payload, io) => {
  const cfg = config.load({ cwd: payload.cwd });
  if (!cfg.gateEnabled(RULE_ID)) return io.allow();
  if (!payload.files.length) return io.allow();

  // Generated output is not worth carrying into the gate.
  const worthTracking = payload.files.filter((f) => !classify(f).isGenerated);
  if (worthTracking.length) {
    changeset.add(payload.sessionId, worthTracking, payload.toolName);
  }

  return io.allow();
});
