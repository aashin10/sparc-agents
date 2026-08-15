'use strict';

/**
 * dotnet — the solution/project graph.
 *
 * Answers the two questions the quality gate actually needs:
 *   "which projects own these files?"  and  "which tests cover those projects?"
 *
 * Scoping to touched projects is not optional. A full solution build on every
 * Stop and the team disables the plugin within a week.
 *
 * The only domain-coupled module in lib/. Everything else stays generic so a
 * second domain pack does not have to fork it.
 */

const fs = require('fs');
const path = require('path');
const { dataDir, ensureDir } = require('./config');

const SKIP_DIRS = new Set(['obj', 'bin', 'node_modules', '.git', '.vs', 'packages', 'TestResults']);
const CACHE_VERSION = 1;

/** Walk up from a starting path looking for the first file matching `re`. */
function findUp(startPath, re, stopAt) {
  let dir = fs.existsSync(startPath) && fs.statSync(startPath).isDirectory()
    ? startPath
    : path.dirname(startPath);
  const stop = stopAt ? path.resolve(stopAt) : null;
  for (;;) {
    let entries;
    try { entries = fs.readdirSync(dir); } catch { return null; }
    const hit = entries.find((e) => re.test(e));
    if (hit) return path.join(dir, hit);
    if (stop && path.resolve(dir) === stop) return null;
    const parent = path.dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

function findSolution(startDir) {
  return findUp(startDir || process.cwd(), /\.slnx?$/i);
}

/** The .csproj that owns a file: nearest ancestor directory containing one. */
function projectFor(filePath) {
  return findUp(filePath, /\.csproj$/i);
}

function listProjects(root) {
  const out = [];
  (function walk(dir, depth) {
    if (depth > 12) return;
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      if (e.isDirectory()) {
        if (SKIP_DIRS.has(e.name) || e.name.startsWith('.')) continue;
        walk(path.join(dir, e.name), depth + 1);
      } else if (/\.csproj$/i.test(e.name)) {
        out.push(path.join(dir, e.name));
      }
    }
  })(root, 0);
  return out;
}

function parseProject(csproj) {
  let xml = '';
  try { xml = fs.readFileSync(csproj, 'utf8'); } catch { return null; }
  const dir = path.dirname(csproj);

  const refs = [];
  const refRe = /<ProjectReference\s+[^>]*Include\s*=\s*"([^"]+)"/gi;
  let m;
  while ((m = refRe.exec(xml))) {
    refs.push(path.resolve(dir, m[1].replace(/\\/g, path.sep)));
  }

  // A test project is one that can actually run tests, not one that is merely
  // named like it can.
  const isTest =
    /<PackageReference\s+[^>]*Include\s*=\s*"Microsoft\.NET\.Test\.Sdk"/i.test(xml) ||
    /<IsTestProject\s*>\s*true\s*<\/IsTestProject>/i.test(xml) ||
    /\.(Tests?|IntegrationTests?|UnitTests?|Specs?)\.csproj$/i.test(csproj);

  return { path: csproj, name: path.basename(csproj, path.extname(csproj)), refs, isTest };
}

function newestMtime(files) {
  let newest = 0;
  for (const f of files) {
    try { newest = Math.max(newest, fs.statSync(f).mtimeMs); } catch { /* vanished */ }
  }
  return Math.round(newest);
}

function cacheFile(root) {
  const key = Buffer.from(path.resolve(root)).toString('base64url').slice(0, 64);
  return path.join(dataDir(), 'cache', `dotnet-graph-${key}.json`);
}

/**
 * Build (or reuse) the project graph rooted at the solution directory.
 * Cached under ${CLAUDE_PLUGIN_DATA}, invalidated when any .csproj changes.
 */
function graph(startDir) {
  const solution = findSolution(startDir);
  const root = solution ? path.dirname(solution) : path.resolve(startDir || process.cwd());
  const csprojs = listProjects(root);
  const stamp = `${CACHE_VERSION}:${csprojs.length}:${newestMtime(csprojs)}`;

  const cf = cacheFile(root);
  try {
    const cached = JSON.parse(fs.readFileSync(cf, 'utf8'));
    if (cached.stamp === stamp) return cached;
  } catch { /* cold cache */ }

  const projects = csprojs.map(parseProject).filter(Boolean);
  const built = { stamp, solution, root, projects };
  try {
    ensureDir(path.dirname(cf));
    fs.writeFileSync(cf, JSON.stringify(built), 'utf8');
  } catch { /* cache is an optimization, not a requirement */ }
  return built;
}

/** Which projects own these files? Returns absolute .csproj paths, deduped. */
function projectsForFiles(files) {
  const out = new Set();
  for (const f of files || []) {
    const p = projectFor(f);
    if (p) out.add(path.resolve(p));
  }
  return [...out];
}

/**
 * Which test projects cover these projects?
 *
 * Walks ProjectReference edges transitively, so a test project that references
 * Api which references Domain still counts as covering a Domain change.
 */
function testProjectsFor(projectPaths, startDir) {
  const g = graph(startDir);
  const targets = new Set((projectPaths || []).map((p) => path.resolve(p)));
  if (!targets.size) return [];

  const byPath = new Map(g.projects.map((p) => [path.resolve(p.path), p]));
  const reaches = (from, seen) => {
    if (targets.has(from)) return true;
    if (seen.has(from)) return false;
    seen.add(from);
    const proj = byPath.get(from);
    if (!proj) return false;
    return proj.refs.some((r) => reaches(path.resolve(r), seen));
  };

  return g.projects
    .filter((p) => p.isTest && reaches(path.resolve(p.path), new Set()))
    .map((p) => p.path);
}

module.exports = {
  findSolution, projectFor, projectsForFiles, testProjectsFor,
  graph, listProjects, parseProject, findUp,
};
