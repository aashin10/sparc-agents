#!/usr/bin/env node
'use strict';

/**
 * pre:config-protection — PreToolUse on Edit|Write|MultiEdit
 *
 * Blocks edits to the files that define what "correct" means. When an analyzer
 * or a warning-as-error is in the way, the cheap move is to weaken the rule and
 * the right move is to fix the code — and the agent cannot tell the difference
 * from inside the task. So the rule files are simply off limits.
 *
 * Pure string matching, no filesystem walk: this runs on every matching tool
 * call against a 150 ms budget.
 */

const { run } = require('../lib/hook-io');
const config = require('../lib/config');
const eventlog = require('../lib/eventlog');

const RULE_ID = 'pre:config-protection';

const PROTECTED = [
  { re: /(^|\/)\.editorconfig$/i, what: 'formatting and analyzer severity' },
  { re: /(^|\/)Directory\.Build\.(props|targets)$/i, what: 'build settings' },
  { re: /(^|\/)Directory\.Packages\.props$/i, what: 'centrally managed package versions' },
  { re: /\.ruleset$/i, what: 'analyzer rule severities' },
  { re: /(^|\/)\.globalconfig$/i, what: 'global analyzer configuration' },
];

function guidance(file, what) {
  return [
    `Blocked: ${file} defines ${what} for the whole solution.`,
    '',
    'Editing it to make an error go away weakens the rule for everyone, and that',
    'change outlives the task that motivated it. Fix the code instead.',
    '',
    'If the analyzer is genuinely wrong here, suppress it at the single call site',
    'with #pragma warning disable and a comment saying why. If the rule itself is',
    'wrong, that is a team decision — raise it rather than changing it in passing.',
  ].join('\n');
}

run((payload, io) => {
  const cfg = config.load({ cwd: payload.cwd });
  if (!cfg.gateEnabled(RULE_ID)) return io.allow();

  for (const file of payload.files) {
    const hit = PROTECTED.find((p) => p.re.test(file.replace(/\\/g, '/')));
    if (!hit) continue;

    eventlog.append({
      session_id: payload.sessionId,
      event: 'pre_tool_use',
      tool: payload.toolName,
      files: [file],
      decision: 'block',
      rule_id: RULE_ID,
    });
    return io.block(guidance(file, hit.what));
  }

  return io.allow();
});
