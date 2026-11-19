// Acceptance gate (fv-architecture section 7): run the new tests against the engine as it was
// at 3e2b5be, before the Codex fixes, and list which tests FAIL there. A test that names a
// Codex finding (#N) but passes on the old engine is not evidence that it catches that bug.
//
//   npm run acceptance              old engine = 3e2b5be
//   npm run acceptance -- <commit>  another commit
//
// It never touches the main checkout's files: it adds a detached git worktree under
// %LOCALAPPDATA%\Temp\gm-accept (or the OS temp folder), links node_modules into it with a
// junction (nothing is installed), copies the new tests and their helpers over the old ones,
// runs vitest there, then removes the link and the worktree. Exit code 1 when a tagged test
// passes on the old engine or the run could not be completed.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const COMMIT = process.argv[2] ?? '3e2b5be';
const tempBase = process.env.LOCALAPPDATA ? path.join(process.env.LOCALAPPDATA, 'Temp') : os.tmpdir();
const wt = path.join(tempBase, 'gm-accept');
const link = path.join(wt, 'node_modules');
// the tests under acceptance (copied when present) and what they need
const TESTS = [
  'test/metamorphic.test.ts',
  'test/rule-claims.test.ts',
  'test/regressions.test.ts',
  'test/containment.test.ts',
  'test/canonical.test.ts',
  'test/oracle-diff.test.ts',
  'test/independence.test.ts',
];
const HELPERS = ['test/arbitraries.ts', 'test/helpers.ts'];
const DIRS = ['oracle', 'sources'];

function git(args, opts = {}) {
  const r = spawnSync('git', args, { cwd: root, encoding: 'utf8', ...opts });
  if (r.status !== 0 && !opts.allowFail) throw new Error(`git ${args.join(' ')} failed:\n${r.stderr}`);
  return r;
}

/** Remove the node_modules junction itself, never what it points to. */
function unlinkJunction() {
  let st;
  try {
    st = fs.lstatSync(link);
  } catch {
    return;
  }
  if (!st.isSymbolicLink()) throw new Error(`${link} is not a link; refusing to delete it`);
  try {
    fs.unlinkSync(link);
  } catch {
    fs.rmdirSync(link); // Windows junctions: removes the link, not the target
  }
}

function cleanup() {
  unlinkJunction();
  if (fs.existsSync(wt)) git(['worktree', 'remove', '--force', wt], { allowFail: true });
  git(['worktree', 'prune'], { allowFail: true });
  if (!fs.existsSync(path.join(root, 'node_modules', 'vitest', 'package.json'))) {
    throw new Error('main node_modules looks damaged after cleanup; run npm ci');
  }
}

function firstLine(msg) {
  const line = String(msg ?? '').replace(/\x1b\[[0-9;]*m/g, '').split('\n').find((l) => l.trim()) ?? '';
  return line.trim().slice(0, 110);
}

let exit = 0;
const t0 = Date.now();
try {
  // a leftover from an interrupted run
  if (fs.existsSync(wt)) {
    console.log(`removing leftover worktree ${wt}`);
    cleanup();
    if (fs.existsSync(wt)) throw new Error(`${wt} exists and is not a worktree of this repo; remove it by hand`);
  }
  const sha = git(['rev-parse', '--short', COMMIT]).stdout.trim();
  console.log(`old engine: ${COMMIT} (${sha}); worktree: ${wt}`);
  git(['worktree', 'add', '--detach', wt, sha]);
  fs.symlinkSync(path.join(root, 'node_modules'), link, 'junction');

  const present = [];
  for (const f of [...TESTS, ...HELPERS]) {
    if (!fs.existsSync(path.join(root, f))) continue;
    fs.mkdirSync(path.dirname(path.join(wt, f)), { recursive: true });
    fs.copyFileSync(path.join(root, f), path.join(wt, f));
    if (TESTS.includes(f)) present.push(f);
  }
  for (const d of DIRS) {
    if (fs.existsSync(path.join(root, d))) fs.cpSync(path.join(root, d), path.join(wt, d), { recursive: true });
  }
  console.log(`tests: ${present.join(', ')}`);

  // own config inside the worktree, so vitest's cache stays out of the main node_modules;
  // fast-check stops at the first counterexample (pass/fail is all the gate needs, and
  // shrinking a failure on the old engine can take minutes)
  fs.writeFileSync(path.join(wt, 'accept-setup.mjs'), "import fc from 'fast-check';\nfc.configureGlobal({ endOnFailure: true });\n");
  fs.writeFileSync(
    path.join(wt, 'vitest.accept.config.mjs'),
    "import { defineConfig } from 'vitest/config';\n" +
      "export default defineConfig({ cacheDir: '.vite-accept', test: { include: ['test/**/*.test.ts'], setupFiles: ['./accept-setup.mjs'], testTimeout: 600000, fileParallelism: false } });\n",
  );
  const json = path.join(wt, 'accept-results.json');
  console.log(`running vitest on the old engine (PROP_RUNS=${process.env.PROP_RUNS ?? '80'}) ...`);
  const r = spawnSync(
    process.execPath,
    [path.join(link, 'vitest', 'vitest.mjs'), 'run', '--config', 'vitest.accept.config.mjs', '--reporter=json', `--outputFile=${json}`, ...present],
    { cwd: wt, encoding: 'utf8', env: { ...process.env, PROP_RUNS: process.env.PROP_RUNS ?? '80' }, maxBuffer: 64 * 1024 * 1024 },
  );
  if (!fs.existsSync(json)) {
    console.error(r.stdout, r.stderr);
    throw new Error('vitest produced no result file');
  }
  const res = JSON.parse(fs.readFileSync(json, 'utf8'));

  const rows = [];
  for (const file of res.testResults) {
    const rel = path.relative(wt, file.name).replace(/\\/g, '/');
    if (file.assertionResults.length === 0) rows.push({ file: rel, test: '(file failed to load)', status: 'failed', msg: firstLine(file.message) });
    for (const a of file.assertionResults) rows.push({ file: rel, test: a.fullName, status: a.status, msg: firstLine(a.failureMessages?.[0]) });
  }
  console.log('\nresult on old engine  test');
  console.log('--------------------  ----');
  for (const row of rows) {
    const verdict = row.status === 'failed' ? 'FAIL (catches)' : row.status === 'passed' ? 'pass (no evidence)' : row.status;
    console.log(`${verdict.padEnd(20)}  ${path.basename(row.file)} > ${row.test}`);
    if (row.status === 'failed' && row.msg) console.log(`${''.padEnd(22)}${row.msg}`);
  }
  // tests that name a Codex finding must fail on the old engine
  const tagged = rows.filter((row) => /#\d+/.test(row.test));
  const noEvidence = tagged.filter((row) => row.status === 'passed');
  const failed = rows.filter((row) => row.status === 'failed').length;
  console.log(`\n${rows.length} tests: ${failed} fail on the old engine, ${rows.length - failed} pass there`);
  console.log(`${tagged.length} tests name a Codex finding; ${noEvidence.length} of them pass on the old engine${noEvidence.length ? ':' : ''}`);
  for (const row of noEvidence) console.log(`  NO EVIDENCE: ${row.test}`);
  if (noEvidence.length > 0) exit = 1;
} catch (e) {
  console.error(`acceptance gate error: ${e instanceof Error ? e.message : String(e)}`);
  exit = 1;
} finally {
  try {
    cleanup();
    console.log(`worktree removed (${((Date.now() - t0) / 1000).toFixed(1)} s)`);
  } catch (e) {
    console.error(`cleanup failed: ${e instanceof Error ? e.message : String(e)}`);
    exit = 1;
  }
}
process.exit(exit);
