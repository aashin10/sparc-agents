'use strict';

/**
 * hook-io — the seam every hook sits on.
 *
 * Reads and normalizes the stdin payload, then exposes the four decisions a
 * hook can make with the correct exit semantics baked in. A hook file should be
 * about thirty lines and contain no I/O of its own.
 *
 *   const { run } = require('../lib/hook-io');
 *   run((payload, io) => {
 *     if (isProtected(payload.files)) return io.block('Edit the code, not the ruleset.');
 *     return io.allow();
 *   });
 *
 * Exit semantics (command-type hooks):
 *   0  allow. Plain stdout goes to the debug log only — it does NOT enter
 *      context. To reach Claude, emit JSON with hookSpecificOutput.
 *   2  block. stderr is fed back to the model. On PostToolUse it surfaces as an
 *      error but cannot block, because the tool already ran.
 *   *  non-blocking error.
 */

const EXIT_ALLOW = 0;
const EXIT_BLOCK = 2;

const STDIN_TIMEOUT_MS = 2000;

function readStdin() {
  return new Promise((resolve) => {
    if (process.stdin.isTTY) return resolve('');
    let raw = '';
    let settled = false;
    const done = () => {
      if (settled) return;
      settled = true;
      resolve(raw);
    };
    // A hook that hangs waiting on stdin is worse than a hook that sees nothing.
    const timer = setTimeout(done, STDIN_TIMEOUT_MS);
    timer.unref?.();
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (chunk) => { raw += chunk; });
    process.stdin.on('end', () => { clearTimeout(timer); done(); });
    process.stdin.on('error', () => { clearTimeout(timer); done(); });
  });
}

/** Pull every file path out of a tool_input, whatever tool it came from. */
function filesFrom(toolInput) {
  if (!toolInput || typeof toolInput !== 'object') return [];
  const out = new Set();
  const add = (v) => { if (typeof v === 'string' && v.length) out.add(v); };
  add(toolInput.file_path);
  add(toolInput.notebook_path);
  add(toolInput.path);
  if (Array.isArray(toolInput.edits)) toolInput.edits.forEach((e) => add(e && e.file_path));
  if (Array.isArray(toolInput.file_paths)) toolInput.file_paths.forEach(add);
  return [...out];
}

function parse(raw) {
  let data = {};
  try {
    data = raw ? JSON.parse(raw) : {};
  } catch (err) {
    // Malformed stdin must not throw — see the fail-open note in run(). But it
    // must not be silent either: a truncated payload makes every hook decide on
    // an empty object and quietly allow everything. On exit 0 this line lands in
    // the debug log, which is where you go when a gate "stopped working".
    process.stderr.write(
      `team-agents: could not parse hook stdin (${raw.length} bytes, ${err.message}). ` +
      'Treating the payload as empty — hooks will allow by default.\n'
    );
    data = {};
  }
  const toolInput = data.tool_input || {};
  return {
    raw: data,
    event: data.hook_event_name || '',
    sessionId: data.session_id || '',
    promptId: data.prompt_id || '',
    transcriptPath: data.transcript_path || '',
    cwd: data.cwd || process.cwd(),
    permissionMode: data.permission_mode || 'default',
    agentId: data.agent_id || '',
    agentType: data.agent_type || '',
    toolName: data.tool_name || '',
    toolInput,
    toolUseId: data.tool_use_id || '',
    toolResult: data.tool_result,
    files: filesFrom(toolInput),
    command: typeof toolInput.command === 'string' ? toolInput.command : '',
    reason: data.reason || '',
  };
}

function emit(obj) {
  process.stdout.write(JSON.stringify(obj));
}

function makeIo(payload) {
  const eventName = payload.event || undefined;
  return {
    /** Proceed silently. */
    allow() {
      return { code: EXIT_ALLOW };
    },

    /** Refuse. `reason` is fed back to the model, so say what to do instead. */
    block(reason) {
      process.stderr.write(String(reason || 'Blocked by team-agents.'));
      return { code: EXIT_BLOCK };
    },

    /** Surface a message to the human. Does not enter Claude's context. */
    warn(message) {
      emit({ systemMessage: String(message) });
      return { code: EXIT_ALLOW };
    },

    /**
     * Put text into Claude's context. It enters untruncated and is summarized at
     * compaction like anything else in the conversation block — keep it short.
     */
    addContext(text) {
      emit({
        hookSpecificOutput: {
          hookEventName: eventName,
          additionalContext: String(text),
        },
      });
      return { code: EXIT_ALLOW };
    },

    /** Escape hatch for the response shapes the four helpers do not cover. */
    json(obj) {
      emit(obj);
      return { code: EXIT_ALLOW };
    },
  };
}

/**
 * Run a hook handler. Handlers return the result of an io.* call, or nothing
 * (treated as allow).
 *
 * Fails OPEN: an exception inside a hook exits 0 with the error on stderr. A
 * crashing guardrail must never be able to wedge someone's session. Hooks that
 * genuinely need to fail closed should catch their own errors and call block().
 */
async function run(handler) {
  let result = { code: EXIT_ALLOW };
  try {
    const payload = parse(await readStdin());
    const io = makeIo(payload);
    result = (await handler(payload, io)) || { code: EXIT_ALLOW };
  } catch (err) {
    process.stderr.write(`team-agents hook error: ${err && err.stack ? err.stack : err}`);
    result = { code: EXIT_ALLOW };
  }
  process.exitCode = result.code;
}

module.exports = { run, parse, filesFrom, readStdin, EXIT_ALLOW, EXIT_BLOCK };
