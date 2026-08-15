#!/usr/bin/env node
'use strict';

/**
 * Hook configuration conformance, plus the two rules that are specific to this
 * repo: every hook carries a stable id and a one-line description, and every
 * hook has a fixture in tests/fixtures/hook-events/.
 */

const fs = require('fs');
const path = require('path');
const { REPO_ROOT, PLUGIN_ROOT, exists, readJson, walk, Report } = require('./lib/ci');

const HOOKS_DIR = path.join(PLUGIN_ROOT, 'hooks');
const FIXTURES = path.join(REPO_ROOT, 'tests', 'fixtures', 'hook-events');

const EVENTS = new Set([
  'SessionStart', 'SessionEnd', 'Setup',
  'UserPromptSubmit', 'UserPromptExpansion', 'Stop', 'StopFailure',
  'PreToolUse', 'PostToolUse', 'PostToolUseFailure', 'PostToolBatch',
  'PermissionRequest', 'PermissionDenied',
  'SubagentStart', 'SubagentStop', 'TaskCreated', 'TaskCompleted', 'TeammateIdle',
  'FileChanged', 'CwdChanged', 'DirectoryAdded', 'ConfigChange', 'InstructionsLoaded',
  'WorktreeCreate', 'WorktreeRemove',
  'PreCompact', 'PostCompact', 'MessageDisplay', 'Notification',
  'Elicitation', 'ElicitationResult',
]);

const HANDLER_TYPES = new Set(['command', 'http', 'mcp_tool', 'prompt', 'agent']);

const r = new Report('validate-hooks');

// Which events do we have fixtures for?
const fixtureEvents = new Set();
for (const f of walk(FIXTURES, (p) => p.endsWith('.json'))) {
  try {
    const ev = readJson(f).hook_event_name;
    if (ev) fixtureEvents.add(ev);
  } catch {
    r.error(f, 'fixture is not valid JSON');
  }
}

const configs = walk(HOOKS_DIR, (p) => p.endsWith('.json'));
if (!configs.length) r.error(HOOKS_DIR, 'no hook configuration found');

for (const file of configs) {
  let cfg;
  try {
    cfg = readJson(file);
  } catch (e) {
    r.error(file, `invalid JSON: ${e.message}`);
    continue;
  }

  if (!cfg.hooks || typeof cfg.hooks !== 'object') {
    r.error(file, 'missing top-level "hooks" object');
    continue;
  }

  for (const [event, groups] of Object.entries(cfg.hooks)) {
    r.checked++;
    if (!EVENTS.has(event)) {
      r.error(file, `unknown hook event "${event}"`);
      continue;
    }
    if (!fixtureEvents.has(event)) {
      r.error(file, `no fixture for "${event}" — add one to tests/fixtures/hook-events/ in this same commit`);
    }
    if (!Array.isArray(groups)) {
      r.error(file, `hooks.${event} must be an array`);
      continue;
    }

    for (const group of groups) {
      r.checked++;
      if (!group.id) r.error(file, `hooks.${event}: a matcher group has no "id" — ids are how gates are referenced and disabled`);
      if (!group.description) r.error(file, `hooks.${event} [${group.id || '?'}]: no "description"`);
      if (group.description && /\n/.test(group.description)) {
        r.error(file, `hooks.${event} [${group.id}]: description must be one line`);
      }
      if (!Array.isArray(group.hooks) || !group.hooks.length) {
        r.error(file, `hooks.${event} [${group.id || '?'}]: empty "hooks" array`);
        continue;
      }

      for (const h of group.hooks) {
        r.checked++;
        const label = `hooks.${event} [${group.id || '?'}]`;
        if (!HANDLER_TYPES.has(h.type)) {
          r.error(file, `${label}: unknown handler type "${h.type}"`);
          continue;
        }
        if (h.type !== 'command') continue;
        if (!h.command) {
          r.error(file, `${label}: command handler with no "command"`);
          continue;
        }

        const usesArgs = Array.isArray(h.args);
        const shellForm = !usesArgs;

        // ${user_config.*} in a shell-form command is a shell-injection vector
        // and is rejected by the loader. Read CLAUDE_PLUGIN_OPTION_* instead.
        const whole = [h.command, ...(h.args || [])].join(' ');
        if (shellForm && /\$\{user_config\./.test(h.command)) {
          r.error(file, `${label}: \${user_config.*} is rejected in shell-form commands. Read CLAUDE_PLUGIN_OPTION_<KEY> from the environment.`);
        }

        // In shell form, an unquoted ${CLAUDE_PLUGIN_ROOT} breaks on any install
        // path containing a space.
        if (shellForm && /\$\{CLAUDE_PLUGIN_ROOT\}/.test(h.command)) {
          if (!/"\$\{CLAUDE_PLUGIN_ROOT\}"/.test(h.command)) {
            r.error(file, `${label}: \${CLAUDE_PLUGIN_ROOT} must be quoted in shell-form commands, or use exec form with "args"`);
          }
        }

        // Referenced scripts must exist.
        for (const token of whole.split(/\s+/)) {
          const mm = /\$\{CLAUDE_PLUGIN_ROOT\}[/\\]([^"'\s]+)/.exec(token);
          if (!mm) continue;
          const target = path.join(PLUGIN_ROOT, mm[1]);
          if (!exists(target)) r.error(file, `${label}: references missing file ${mm[1]}`);
        }

        if (h.timeout !== undefined && (typeof h.timeout !== 'number' || h.timeout <= 0)) {
          r.error(file, `${label}: "timeout" must be a positive number of seconds`);
        }
        if (event === 'PreToolUse' && typeof h.timeout === 'number' && h.timeout > 5) {
          r.warn(file, `${label}: PreToolUse runs on every matching tool call and has a 150 ms budget; a ${h.timeout}s timeout is a design smell`);
        }
      }
    }
  }
}

r.finish();
