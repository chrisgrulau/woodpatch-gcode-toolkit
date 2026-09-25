// SPDX-FileCopyrightText: 2026 Promotional Notions Pty Ltd trading as Woodpatch House & Garden
// SPDX-License-Identifier: MIT
//
// Records CHARACTERISATION GOLDENS: what upstream webgcode's own parser and
// simulator do with each fixture, bugs included (plan §5 Phase 1, ADR-0012).
// The Phase 2 rewrite is compared against these, so every behaviour change
// is visible and deliberate. Where upstream was right, the rewrite must match;
// where upstream was wrong (R1–R9), it must differ, and the difference is listed.
//
// Usage:
//   node tools/golden-legacy.cjs                     regenerate all goldens
//   node tools/golden-legacy.cjs --check             exit 1 if any golden is stale (CI)
//   node tools/golden-legacy.cjs --full <file.ngc>   print the FULL path of one file,
//                                                    for diagnosing a hash mismatch
//   node tools/golden-legacy.cjs --corpus <dir> --out <dir> [--check]
//                                                    run on another corpus (the private
//                                                    fixtures repo uses this)
//
// Golden size policy (operator decision 2026-09-25, "option C"): files with at most
// FULL_LIMIT segments store the full path. Larger files store the summary, the
// first and last SAMPLE segments, and a SHA-256 of the full canonical path, so any
// change to any segment is detected without committing tens of MB. Use --full to
// see the whole path locally.
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { load, workerDollar, jqDollar } = require('./legacy-harness.cjs');

const ROOT = path.resolve(__dirname, '..');
const FULL_LIMIT = 10000;
const SAMPLE = 200;
const DECIMALS = 6; // 1 nm / 1 µrad. Deterministic on a pinned Node; far below any real tolerance.
const SCHEMA = 1;

// ── Canonical numbers ─────────────────────────────────────────────────────
// Round to DECIMALS and normalise -0 to 0, so output depends only on the value.
// NaN and ±Infinity have no JSON form; they are exactly the kind of upstream
// behaviour a golden must capture (R2 produces NaN centres), so they become strings.
function num(v) {
  if (typeof v !== 'number') return v;
  if (Number.isNaN(v)) return 'NaN';
  if (!Number.isFinite(v)) return v > 0 ? 'Infinity' : '-Infinity';
  const r = Math.round(v * 10 ** DECIMALS) / 10 ** DECIMALS;
  return Object.is(r, -0) ? 0 : r;
}
const xyz = (p) => (p ? [num(p.x), num(p.y), num(p.z)] : null);

// Segment tuples. Documented in each golden's "format" field so the file explains itself.
const FORMAT = {
  line: [
    '"L"',
    'lineNo (0-based, as upstream)',
    'speedTag',
    'feedRate',
    'from [x,y,z]',
    'to [x,y,z]',
  ],
  arc: [
    '"A"',
    'lineNo (0-based)',
    'speedTag',
    'feedRate',
    'from [x,y,z]',
    'to [x,y,z]',
    'plane (first+second coord, e.g. "xy", "zx")',
    'centre [x,y,z] (centerInPlane)',
    'radius',
    'fromAngle (rad)',
    'angularDistance (rad; sign = direction)',
  ],
  other: ['"?"', 'lineNo', 'type', 'raw JSON of any segment type not listed above'],
};

function tuple(s) {
  if (s.type === 'line')
    return ['L', s.lineNo, s.speedTag, num(s.feedRate), xyz(s.from), xyz(s.to)];
  if (s.type === 'arc')
    return [
      'A',
      s.lineNo,
      s.speedTag,
      num(s.feedRate),
      xyz(s.from),
      xyz(s.to),
      s.plane ? s.plane.firstCoord + s.plane.secondCoord : null,
      xyz(s.centerInPlane),
      num(s.radius),
      num(s.fromAngle),
      num(s.angularDistance),
    ];
  return ['?', s.lineNo, s.type, JSON.stringify(s, (k, v) => num(v))];
}

// ── Running upstream ──────────────────────────────────────────────────────
// Upstream prints debug output (e.g. G10 dumps its words). Capture it into the
// golden instead of letting it leak into CI logs: it is behaviour too.
function captureConsole(fn) {
  const lines = [];
  const saved = { log: console.log, warn: console.warn, error: console.error, info: console.info };
  for (const k of Object.keys(saved)) {
    console[k] = (...args) =>
      lines.push(
        `${k}: ${args.map((a) => (typeof a === 'string' ? a : safeJson(a))).join(' ')}`.slice(
          0,
          500,
        ),
      );
  }
  try {
    return { value: fn(), console: lines };
  } finally {
    Object.assign(console, saved);
  }
}
function safeJson(a) {
  try {
    return JSON.stringify(a);
  } catch {
    return String(a);
  }
}

// One full characterisation run with one `$` flavour.
function characterise(code, dollar) {
  const m = load(dollar);
  const errors = [];
  const run = captureConsole(() => {
    try {
      const segments = m.parser.evaluate(code, null, null, null, errors) || [];
      const sim = m.gcodeSimulation.simulateGCode(code, new m.util.Point(0, 0, 0), () => {});
      return { outcome: 'ok', segments, sim };
    } catch (e) {
      // Engine-specific messages (stack sizes) would make goldens platform-dependent;
      // the error's class is the stable, meaningful part.
      return { outcome: 'throw', thrown: e && e.constructor ? e.constructor.name : String(e) };
    }
  });
  const r = run.value;
  const result = {
    outcome: r.outcome,
    ...(r.thrown ? { thrown: r.thrown } : {}),
    errors: errors.map((e) => ({ lineNo: e.lineNo, message: e.message, line: e.line })),
    console: run.console,
  };
  if (r.outcome !== 'ok') return { result, tuples: [] };
  const tuples = r.segments.map(tuple);
  const counts = {};
  for (const s of r.segments) {
    const k = `${s.type}:${s.speedTag}`;
    counts[k] = (counts[k] || 0) + 1;
  }
  result.summary = {
    segments: tuples.length,
    byKindAndSpeed: Object.fromEntries(Object.entries(counts).sort()),
    // bbox and time come from upstream's SIMULATOR (the discretised path, R11),
    // which is what the live page showed, not from the exact segments above.
    simulatedBbox: { min: xyz(r.sim.min), max: xyz(r.sim.max) },
    simulatedTotalTimeSeconds: num(r.sim.totalTime),
    simulatorErrors: (r.sim.errors || []).map((e) => safeJson(e)),
  };
  return { result, tuples };
}

const canonicalPath = (tuples) => tuples.map((t) => JSON.stringify(t)).join('\n');

function golden(file, relName, withJquery) {
  const bytes = fs.readFileSync(file);
  const code = bytes.toString('utf8');
  const worker = characterise(code, workerDollar);
  const g = {
    schema: SCHEMA,
    generator: 'tools/golden-legacy.cjs',
    source: {
      file: relName,
      sha256: createHash('sha256').update(bytes).digest('hex'),
      bytes: bytes.length,
    },
    harness: '$ = worker flavour (what the live simulator ran)',
    ...worker.result,
  };
  // The jQuery-faithful `$` differs only where upstream's `$.each` bug matters (R1).
  // Record it only when it actually differs, and only for the small synthetic cases.
  if (withJquery) {
    const jq = characterise(code, jqDollar);
    const same =
      JSON.stringify(jq.result) === JSON.stringify(worker.result) &&
      canonicalPath(jq.tuples) === canonicalPath(worker.tuples);
    g.jqueryFlavour = same
      ? 'identical'
      : { ...jq.result, pathSha256: sha(canonicalPath(jq.tuples)) };
  }
  const full = worker.tuples.length <= FULL_LIMIT;
  g.path = {
    format: FORMAT,
    mode: full ? 'full' : 'sampled',
    count: worker.tuples.length,
    sha256: sha(canonicalPath(worker.tuples)),
    ...(full
      ? { segments: worker.tuples }
      : {
          head: worker.tuples.slice(0, SAMPLE),
          tail: worker.tuples.slice(-SAMPLE),
          note: `Only the first and last ${SAMPLE} of ${worker.tuples.length} segments are stored. sha256 covers all of them; run --full to see the whole path.`,
        }),
  };
  return { g, tuples: worker.tuples };
}
const sha = (s) => createHash('sha256').update(s).digest('hex');

// Pretty at the top level, but ONE SEGMENT PER LINE, so a diff points at segments.
function serialise(g) {
  const segKeys = ['segments', 'head', 'tail'];
  const pathObj = g.path;
  const placeholder = {};
  for (const k of segKeys) if (pathObj[k]) placeholder[k] = `@@${k}@@`;
  let text = JSON.stringify({ ...g, path: { ...pathObj, ...placeholder } }, null, 2);
  for (const k of segKeys) {
    if (!pathObj[k]) continue;
    const body = pathObj[k].length
      ? '[\n' + pathObj[k].map((t) => '      ' + JSON.stringify(t)).join(',\n') + '\n    ]'
      : '[]';
    text = text.replace(`"@@${k}@@"`, body);
  }
  return text + '\n';
}

// ── CLI ───────────────────────────────────────────────────────────────────
function arg(name) {
  const i = process.argv.indexOf(name);
  return i === -1 ? undefined : process.argv[i + 1];
}

function main() {
  const fullFile = arg('--full');
  if (fullFile) {
    const { tuples } = golden(path.resolve(fullFile), fullFile, false);
    process.stdout.write(canonicalPath(tuples) + '\n');
    return 0;
  }

  const check = process.argv.includes('--check');
  const corpusArg = arg('--corpus');
  const outArg = arg('--out');
  // --out is REQUIRED with --corpus, and may not be a directory that holds anything
  // but goldens. The generator deletes orphan goldens, so an --out that defaulted to
  // the working directory once deleted package.json (reviewer, PR #5).
  if (corpusArg) {
    if (!outArg) return usageError('--corpus requires --out <dir>');
    const out = path.resolve(outArg);
    const bad = [ROOT, path.resolve(corpusArg), process.cwd(), path.parse(out).root];
    if (bad.includes(out))
      return usageError(`refusing --out ${outArg}: it must be a dedicated goldens directory`);
  }
  const corpora = corpusArg
    ? [{ dir: path.resolve(corpusArg), out: path.resolve(outArg), jquery: false }]
    : [
        {
          dir: path.join(ROOT, 'fixtures/synthetic'),
          out: path.join(ROOT, 'fixtures/golden/legacy/synthetic'),
          jquery: true,
        },
        {
          dir: path.join(ROOT, 'fixtures/upstream'),
          out: path.join(ROOT, 'fixtures/golden/legacy/upstream'),
          jquery: false,
        },
      ];

  let stale = 0;
  for (const c of corpora) {
    fs.mkdirSync(c.out, { recursive: true });
    const inputs = fs
      .readdirSync(c.dir)
      .filter((f) => /\.(ngc|nc|gcode|tap)$/i.test(f))
      .sort();
    const expected = new Set();
    for (const f of inputs) {
      const outName = f.replace(/\.[^.]+$/, '') + '.json';
      // foo.nc and foo.ngc would both write foo.json, and the last would silently win.
      if (expected.has(outName)) return usageError(`two inputs map to ${outName} in ${c.dir}`);
      expected.add(outName);
      const rel = path.relative(ROOT, path.join(c.dir, f)).split(path.sep).join('/');
      const want = serialise(
        golden(path.join(c.dir, f), rel.startsWith('..') ? f : rel, c.jquery).g,
      );
      const outPath = path.join(c.out, outName);
      const have = fs.existsSync(outPath) ? fs.readFileSync(outPath, 'utf8') : null;
      if (have === want) continue;
      if (check) {
        console.error(`stale golden: ${path.relative(ROOT, outPath)}`);
        stale++;
      } else {
        fs.writeFileSync(outPath, want);
        console.log(`wrote ${path.relative(ROOT, outPath)}`);
      }
    }
    // A golden whose fixture was deleted is stale too. Only files THIS generator wrote
    // are ever candidates: any other .json in the directory is left strictly alone.
    for (const f of fs.readdirSync(c.out).filter((f) => f.endsWith('.json'))) {
      if (expected.has(f)) continue;
      if (!isOurGolden(path.join(c.out, f))) continue;
      if (check) {
        console.error(`orphan golden (no fixture): ${path.relative(ROOT, path.join(c.out, f))}`);
        stale++;
      } else {
        fs.unlinkSync(path.join(c.out, f));
        console.log(`removed orphan ${path.relative(ROOT, path.join(c.out, f))}`);
      }
    }
  }
  if (stale)
    console.error(`${stale} golden(s) stale. Regenerate with: node tools/golden-legacy.cjs`);
  return stale ? 1 : 0;
}

function isOurGolden(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8')).generator === 'tools/golden-legacy.cjs';
  } catch {
    return false;
  }
}

function usageError(msg) {
  console.error(`golden-legacy: ${msg}`);
  return 2;
}

process.exitCode = main();
