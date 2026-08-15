'use strict';

/**
 * config — resolve the effective configuration for a hook run.
 *
 * Precedence, highest first:
 *   1. repo .team-agents.json          (per-repo, version controlled)
 *   2. CLAUDE_PLUGIN_OPTION_*          (from the manifest's userConfig)
 *   3. profile default                 (manifests/install-profiles.json)
 *
 * Repo-level config needs its own file rather than riding on pluginConfigs
 * because pluginConfigs values are read only from user settings, --settings, and
 * managed settings. Project settings are deliberately ignored — a cloned
 * repository could otherwise inject values into hook commands and MCP configs.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

const PROFILES = ['minimal', 'standard', 'strict'];
const REPO_CONFIG = '.team-agents.json';

/** Plugin install directory. Read-only — never write here, it changes on update. */
function pluginRoot() {
  return process.env.CLAUDE_PLUGIN_ROOT || path.resolve(__dirname, '..', '..');
}

/**
 * Writable state directory. Survives plugin updates.
 * Everything the plugin writes goes here: telemetry, changesets, caches.
 */
function dataDir() {
  const fromEnv = process.env.CLAUDE_PLUGIN_DATA;
  if (fromEnv) return fromEnv;
  // Dev fallback for `claude --plugin-dir`, where the variable may be unset.
  return path.join(os.homedir(), '.claude', 'plugins', 'data', 'team-agents');
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function readJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return fallback;
  }
}

function profileManifest() {
  return readJson(path.join(pluginRoot(), 'manifests', 'install-profiles.json'), {
    defaultProfile: 'standard',
    profiles: {},
    options: {},
  });
}

function coerce(value, like) {
  if (typeof like === 'boolean') return /^(1|true|yes|on)$/i.test(String(value));
  if (typeof like === 'number') {
    const n = Number(value);
    return Number.isFinite(n) ? n : like;
  }
  if (Array.isArray(like)) {
    if (Array.isArray(value)) return value;
    return String(value).split(',').map((s) => s.trim()).filter(Boolean);
  }
  return String(value);
}

/** Walk up from cwd looking for .team-agents.json. Stops at the filesystem root. */
function findRepoConfig(startDir) {
  let dir = path.resolve(startDir || process.cwd());
  for (;;) {
    const candidate = path.join(dir, REPO_CONFIG);
    if (fs.existsSync(candidate)) return candidate;
    const parent = path.dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

/**
 * @param {{cwd?: string}} [opts]
 * @returns {{profile: string, domains: string[], track_usage: boolean,
 *            context_budget: number, gates: Record<string, boolean>,
 *            sources: {repoConfig: string|null}, gateEnabled: (id: string) => boolean}}
 */
function load(opts) {
  const manifest = profileManifest();
  const defaults = Object.assign(
    { profile: manifest.defaultProfile || 'standard', domains: ['backend'], track_usage: true, context_budget: 2500 },
    manifest.options || {}
  );

  const resolved = Object.assign({}, defaults, { gates: {} });

  // 2. environment, from the manifest's userConfig block
  for (const key of Object.keys(defaults)) {
    const envKey = `CLAUDE_PLUGIN_OPTION_${key.toUpperCase()}`;
    if (process.env[envKey] !== undefined && process.env[envKey] !== '') {
      resolved[key] = coerce(process.env[envKey], defaults[key]);
    }
  }

  // 1. repo file wins
  const repoConfigPath = findRepoConfig(opts && opts.cwd);
  if (repoConfigPath) {
    const repo = readJson(repoConfigPath, {});
    for (const key of Object.keys(defaults)) {
      if (repo[key] !== undefined) resolved[key] = repo[key];
    }
    if (repo.gates && typeof repo.gates === 'object') resolved.gates = repo.gates;
  }

  // An unknown profile must never fail a session — fall back rather than throw.
  if (!PROFILES.includes(resolved.profile)) resolved.profile = 'standard';

  resolved.sources = { repoConfig: repoConfigPath };
  resolved.gateEnabled = (id) => {
    if (resolved.profile === 'minimal') return false;
    return resolved.gates[id] !== false;
  };
  return resolved;
}

module.exports = { load, pluginRoot, dataDir, ensureDir, readJson, findRepoConfig, PROFILES, REPO_CONFIG };
