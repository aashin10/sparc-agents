#!/usr/bin/env node
'use strict';

/**
 * session:banner — SessionStart
 *
 * Phase 0's proof of life. It confirms three things at once: that
 * ${CLAUDE_PLUGIN_ROOT} resolves, that the lib seam loads from a hook, and that
 * config precedence produces a sane profile. Replace the body, keep the shape —
 * a hook file should stay about this long.
 */

const { run } = require('../lib/hook-io');
const config = require('../lib/config');
const eventlog = require('../lib/eventlog');

run((payload, io) => {
  const cfg = config.load({ cwd: payload.cwd });

  eventlog.append({
    session_id: payload.sessionId,
    event: 'session_start',
    decision: 'allow',
    rule_id: 'session:banner',
    meta: { profile: cfg.profile, domains: cfg.domains, source: payload.raw.source || '' },
  });

  if (cfg.profile === 'minimal') return io.allow();

  const from = cfg.sources.repoConfig ? ' (.team-agents.json)' : '';
  return io.addContext(
    `team-agents active — profile: ${cfg.profile}${from}, domains: ${cfg.domains.join(', ') || 'none'}.`
  );
});
