'use strict';

/**
 * classify — what kind of file is this?
 *
 * Every hook needs this and nobody writes it once, so it lives here. Pure string
 * work on purpose: it runs inside the PreToolUse 150 ms budget, so it must not
 * touch the filesystem. Authoritative project ownership needs the .csproj graph
 * and lives in dotnet.js instead; the `project` returned here is a path
 * heuristic, good enough to group files and to decide whether to bother.
 *
 *   classify('/repo/src/Api/Controllers/PlanController.cs')
 *   // { domain: 'backend', layer: 'api', project: 'Api', isTest: false,
 *   //   isMigration: false, isController: true, isGenerated: false }
 */

const path = require('path');

const BACKEND_EXT = new Set([
  '.cs', '.csproj', '.sln', '.slnx', '.props', '.targets', '.razor', '.cshtml',
  '.resx', '.ruleset', '.globalconfig', '.editorconfig',
]);

// Ordered: first match wins, so the more specific segment names come first.
const LAYERS = [
  ['test', /^(tests?|specs?|testing)$/i],
  ['api', /^(api|web|webapi|host|presentation|endpoints?|controllers?)$/i],
  ['application', /^(application|app|services?|features?|handlers?|usecases?)$/i],
  ['domain', /^(domain|core|model|models|entities)$/i],
  ['infrastructure', /^(infrastructure|infra|persistence|data|repositories|migrations)$/i],
  ['contracts', /^(contracts?|shared|common|abstractions|dtos?)$/i],
];

const GENERATED = [
  /(^|\/)(obj|bin)\//i,
  /\.g\.cs$/i,
  /\.g\.i\.cs$/i,
  /\.designer\.cs$/i,
  /\.generated\.cs$/i,
  /(^|\/)AssemblyInfo\.cs$/i,
  /(^|\/)GlobalUsings\.g\.cs$/i,
  /\.feature\.cs$/i,
  /(^|\/)Migrations\/.*Designer\.cs$/i,
];

const TEST_FILE = /(Tests?|Specs?|Fixture)\.cs$/;
const TEST_SEGMENT = /^(tests?|specs?)$/i;
const TEST_PROJECT = /\.(Tests?|IntegrationTests?|UnitTests?|Specs?)$/i;

// EF Core stamps migrations with a 14-digit UTC timestamp prefix.
const MIGRATION_FILE = /(^|\/)\d{14}_[^/]+\.cs$/;

function toPosix(p) {
  return String(p || '').replace(/\\/g, '/');
}

function segmentsOf(p) {
  return toPosix(p).split('/').filter(Boolean);
}

/**
 * Best-effort project name from the path shape: the segment directly under
 * src/, tests/, or source/. Falls back to the nearest directory whose name
 * looks like a project (dotted PascalCase).
 */
function projectFromPath(segments) {
  const roots = ['src', 'source', 'tests', 'test', 'samples'];
  for (let i = 0; i < segments.length - 1; i++) {
    if (roots.includes(segments[i].toLowerCase())) return segments[i + 1];
  }
  // No src/ convention — look for a Foo.Bar-shaped directory.
  for (let i = segments.length - 2; i >= 0; i--) {
    if (/^[A-Z][A-Za-z0-9]*(\.[A-Z][A-Za-z0-9]*)+$/.test(segments[i])) return segments[i];
  }
  return segments.length > 1 ? segments[segments.length - 2] : '';
}

function layerFromPath(segments) {
  for (const seg of segments) {
    for (const [name, re] of LAYERS) {
      if (re.test(seg)) return name;
    }
  }
  // Fall back to the suffix of the owning project: Foo.Infrastructure -> infrastructure
  const project = projectFromPath(segments);
  const suffix = project.split('.').pop() || '';
  for (const [name, re] of LAYERS) {
    if (re.test(suffix)) return name;
  }
  return 'unknown';
}

/**
 * @param {string} filePath
 * @returns {{path: string, ext: string, domain: string|null, layer: string,
 *            project: string, isTest: boolean, isMigration: boolean,
 *            isController: boolean, isGenerated: boolean, isSource: boolean}}
 */
function classify(filePath) {
  const posix = toPosix(filePath);
  const segments = segmentsOf(posix);
  const base = segments[segments.length - 1] || '';
  const ext = path.extname(base).toLowerCase();

  const isGenerated = GENERATED.some((re) => re.test(posix));
  const project = projectFromPath(segments);

  const isTest =
    TEST_FILE.test(base) ||
    TEST_PROJECT.test(project) ||
    segments.some((s) => TEST_SEGMENT.test(s));

  const isMigration =
    MIGRATION_FILE.test(posix) ||
    (segments.some((s) => /^migrations$/i.test(s)) && ext === '.cs');

  return {
    path: posix,
    ext,
    domain: BACKEND_EXT.has(ext) ? 'backend' : null,
    layer: isTest ? 'test' : layerFromPath(segments),
    project,
    isTest,
    isMigration,
    isController: /Controller\.cs$/.test(base),
    isGenerated,
    // Worth running tooling over: real C# the author actually wrote.
    isSource: ext === '.cs' && !isGenerated,
  };
}

/** Classify many paths and keep only the ones worth acting on. */
function sourceFiles(files) {
  return (files || []).map(classify).filter((c) => c.isSource);
}

module.exports = { classify, sourceFiles, projectFromPath, layerFromPath, toPosix };
