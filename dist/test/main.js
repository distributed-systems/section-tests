import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { defineTests, suite, test } from '../index.js';
import SpecReporter from '../src/SpecReporter.js';
const rootDirectory = fileURLToPath(new URL('../..', import.meta.url));
const sectionTestsImportUrl = pathToFileURL(join(rootDirectory, 'dist', 'index.js')).href;
const runnerPath = join(rootDirectory, 'dist', 'bin', 'run.js');
const JSON_SUMMARY_PREFIX = 'SECTION_TESTS_SUMMARY:';
async function createFixtureFile(name, content) {
    const tempDirectory = await mkdtemp(join(tmpdir(), 'section-tests-runner-'));
    const testFilePath = join(tempDirectory, name);
    await writeFile(testFilePath, content, 'utf8');
    return tempDirectory;
}
async function readJsonLines(path) {
    const contents = await readFile(path, 'utf8');
    return contents
        .trim()
        .split('\n')
        .filter((line) => line.trim().length > 0)
        .map((line) => JSON.parse(line));
}
function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}
function stripAnsi(text) {
    return text
        .replace(/\u001B\[[0-9;?]*[ -/]*[@-~]/g, '')
        .replace(/\u001B\][^\u0007]*(\u0007|\u001B\\)/g, '');
}
function createCollectedTest(id, name, suitePath, file, entryPath) {
    return {
        id,
        file,
        name,
        suitePath,
        mode: 'parallel',
        timeout: 1000,
        entryPath: [entryPath],
        source: {
            hasSetup: false,
            hasTeardown: false,
        },
    };
}
function createPlan(tests) {
    return {
        files: Array.from(new Set(tests.map((test) => test.file))),
        tests,
    };
}
function eventBase(test) {
    return {
        testId: test.id,
        file: test.file,
        suitePath: test.suitePath,
        testName: test.name,
    };
}
function createReporterHarness({ compactThreshold = 80, renderIntervalMs = 5, maxRunningTests = 6, } = {}) {
    const frames = [];
    let doneCalls = 0;
    const renderer = ((message) => {
        frames.push(stripAnsi(message));
    });
    renderer.done = () => {
        doneCalls += 1;
    };
    const reporter = new SpecReporter({
        interactive: true,
        compactThreshold,
        renderIntervalMs,
        maxRunningTests,
        output: { isTTY: true },
        createRenderer: () => renderer,
    });
    return {
        reporter,
        frames,
        getLastFrame: () => frames[frames.length - 1] || '',
        getDoneCalls: () => doneCalls,
    };
}
async function captureConsoleLogs(execute) {
    const originalConsoleLog = console.log;
    const lines = [];
    console.log = (...args) => {
        lines.push(stripAnsi(args.map((value) => String(value)).join(' ')));
    };
    try {
        await execute();
    }
    finally {
        console.log = originalConsoleLog;
    }
    return lines;
}
export default defineTests(suite('API', test('passes setup results into run and teardown', {
    async setup(context) {
        context.info('creating setup payload');
        return { counter: 1 };
    },
    async run(payload) {
        assert.equal(payload.counter, 1);
        payload.counter = 2;
    },
    async teardown(payload) {
        assert.equal(payload.counter, 2);
    },
})), suite('CLI', test('runs tests in parallel with isolated runtime state', {
    timeout: 15000,
    async run() {
        const markerFile = join(await mkdtemp(join(tmpdir(), 'section-tests-parallel-')), 'results.jsonl');
        const fixtureDirectory = await createFixtureFile('parallel.test.mjs', `
import { appendFile } from 'node:fs/promises';
import { test } from ${JSON.stringify(sectionTestsImportUrl)};

export default [
  test('first', {
    async setup() {
      return { id: Math.random().toString(16).slice(2) };
    },
    async run(value) {
      await appendFile(${JSON.stringify(markerFile)}, JSON.stringify({ name: 'first', id: value.id }) + '\\n');
      await new Promise((resolve) => setTimeout(resolve, 400));
    },
  }),
  test('second', {
    async setup() {
      return { id: Math.random().toString(16).slice(2) };
    },
    async run(value) {
      await appendFile(${JSON.stringify(markerFile)}, JSON.stringify({ name: 'second', id: value.id }) + '\\n');
      await new Promise((resolve) => setTimeout(resolve, 400));
    },
  }),
];
`);
        const startedAt = Date.now();
        const result = spawnSync(process.execPath, [runnerPath, '--jobs=2', './parallel.test.mjs'], {
            cwd: fixtureDirectory,
            encoding: 'utf8',
            env: process.env,
        });
        const elapsedMs = Date.now() - startedAt;
        assert.equal(result.status, 0, result.stderr || result.stdout);
        assert.match(result.stdout, /first/i);
        assert.match(result.stdout, /second/i);
        assert.ok(elapsedMs < 1000, `expected parallel run under 1000ms, got ${elapsedMs}`);
        const lines = (await readFile(markerFile, 'utf8')).trim().split('\n').map((line) => JSON.parse(line));
        assert.equal(lines.length, 2);
        assert.notEqual(lines[0].id, lines[1].id);
    },
}), test('reuses a clean worker without reimporting the file', {
    timeout: 15000,
    async run() {
        const markerFile = join(await mkdtemp(join(tmpdir(), 'section-tests-reuse-')), 'results.jsonl');
        const fixtureDirectory = await createFixtureFile('reuse.test.mjs', `
import { appendFile } from 'node:fs/promises';
import { test } from ${JSON.stringify(sectionTestsImportUrl)};

globalThis.__sectionTestsImportCount = (globalThis.__sectionTestsImportCount ?? 0) + 1;
const workerMarker = (globalThis.__sectionTestsWorkerMarker ??= Math.random().toString(16).slice(2));

export default [
  test('first reuse', async () => {
    await appendFile(${JSON.stringify(markerFile)}, JSON.stringify({
      test: 'first',
      workerMarker,
      importCount: globalThis.__sectionTestsImportCount,
    }) + '\\n');
  }),
  test('second reuse', async () => {
    await appendFile(${JSON.stringify(markerFile)}, JSON.stringify({
      test: 'second',
      workerMarker,
      importCount: globalThis.__sectionTestsImportCount,
    }) + '\\n');
  }),
];
`);
        const result = spawnSync(process.execPath, [runnerPath, '--jobs=1', './reuse.test.mjs'], {
            cwd: fixtureDirectory,
            encoding: 'utf8',
            env: process.env,
        });
        assert.equal(result.status, 0, result.stderr || result.stdout);
        assert.match(result.stdout, /avg\/test .* \| load .* \| total .* \| avg parallelism/i);
        const lines = await readJsonLines(markerFile);
        assert.equal(lines.length, 2);
        assert.equal(lines[0].workerMarker, lines[1].workerMarker);
        assert.equal(lines[0].importCount, 1);
        assert.equal(lines[1].importCount, 1);
    },
}), test('keeps serial tests exclusive when requested', {
    timeout: 15000,
    async run() {
        const fixtureDirectory = await createFixtureFile('serial.test.mjs', `
import { serial } from ${JSON.stringify(sectionTestsImportUrl)};

export default [
  serial('first serial', async () => {
    await new Promise((resolve) => setTimeout(resolve, 250));
  }),
  serial('second serial', async () => {
    await new Promise((resolve) => setTimeout(resolve, 250));
  }),
];
`);
        const startedAt = Date.now();
        const result = spawnSync(process.execPath, [runnerPath, '--jobs=4', './serial.test.mjs'], {
            cwd: fixtureDirectory,
            encoding: 'utf8',
            env: process.env,
        });
        const elapsedMs = Date.now() - startedAt;
        assert.equal(result.status, 0, result.stderr || result.stdout);
        assert.ok(elapsedMs >= 450, `expected serial run to take at least 450ms, got ${elapsedMs}`);
    },
}), test('emits machine-readable suite summary when enabled', {
    timeout: 15000,
    async run() {
        const fixtureDirectory = await createFixtureFile('failure.test.mjs', `
import assert from 'node:assert/strict';
import { test } from ${JSON.stringify(sectionTestsImportUrl)};

export default [
  test('example', async () => {
    assert.equal(1, 2, 'failing test');
  }),
];
`);
        const result = spawnSync(process.execPath, [runnerPath, '--json-summary', './failure.test.mjs'], {
            cwd: fixtureDirectory,
            encoding: 'utf8',
            env: process.env,
        });
        assert.equal(result.status, 1, 'failing tests should exit non-zero');
        assert.match(result.stdout, /1 \/ 1 tests failed!/i);
        assert.match(result.stderr, /SECTION_TESTS_SUMMARY:/i);
        const summaryLine = result.stderr
            .split('\n')
            .map((line) => line.trim())
            .find((line) => line.startsWith(JSON_SUMMARY_PREFIX));
        assert.ok(summaryLine, 'expected machine-readable summary line on stderr');
        const summary = JSON.parse(summaryLine.slice(JSON_SUMMARY_PREFIX.length));
        assert.equal(summary.type, 'section-tests.suite-end');
        assert.equal(summary.ok, 0);
        assert.equal(summary.failed, 1);
        assert.equal(summary.total, 1);
        assert.equal(summary.pass, false);
        assert.equal(typeof summary.durationMs, 'number');
    },
}), test('uses runner default timeout for tests without per-test timeout', {
    timeout: 15000,
    async run() {
        const fixtureDirectory = await createFixtureFile('default-timeout.test.mjs', `
import { test } from ${JSON.stringify(sectionTestsImportUrl)};

export default [
  test('uses default timeout', async () => {
    await new Promise(() => {});
  }),
];
`);
        const result = spawnSync(process.execPath, [runnerPath, '--timeout=100', '--timeout-grace=200', './default-timeout.test.mjs'], {
            cwd: fixtureDirectory,
            encoding: 'utf8',
            env: process.env,
        });
        assert.equal(result.status, 1, 'timed out tests should exit non-zero');
        assert.match(result.stdout, /timed out after 100 milliseconds/i);
    },
}), test('attempts teardown after a run timeout', {
    timeout: 15000,
    async run() {
        const tempDirectory = await mkdtemp(join(tmpdir(), 'section-tests-timeout-'));
        const markerFile = join(tempDirectory, 'teardown.txt');
        const fixtureDirectory = await createFixtureFile('timeout-teardown.test.mjs', `
import { appendFile } from 'node:fs/promises';
import { test } from ${JSON.stringify(sectionTestsImportUrl)};

export default [
  test('times out and cleans up', {
    timeout: 120,
    async setup() {
      return ${JSON.stringify(markerFile)};
    },
    async run() {
      await new Promise(() => {});
    },
    async teardown(marker) {
      await appendFile(marker, 'teardown-completed\\n');
    },
  }),
];
`);
        const result = spawnSync(process.execPath, [runnerPath, '--timeout-grace=240', './timeout-teardown.test.mjs'], {
            cwd: fixtureDirectory,
            encoding: 'utf8',
            env: process.env,
        });
        assert.equal(result.status, 1, 'timed out tests should exit non-zero');
        assert.match(result.stdout, /\[timeout run 120 ms, teardown completed\]/i);
        assert.match(result.stdout, /teardown completed/i);
        const markerContents = await readFile(markerFile, 'utf8');
        assert.match(markerContents, /teardown-completed/);
    },
}), test('retires a worker after teardown failure and replaces it', {
    timeout: 15000,
    async run() {
        const markerFile = join(await mkdtemp(join(tmpdir(), 'section-tests-teardown-failure-')), 'results.jsonl');
        const fixtureDirectory = await createFixtureFile('teardown-failure.test.mjs', `
import { appendFile } from 'node:fs/promises';
import { test } from ${JSON.stringify(sectionTestsImportUrl)};

const workerMarker = (globalThis.__sectionTestsWorkerMarker ??= Math.random().toString(16).slice(2));

export default [
  test('breaks teardown', {
    async run() {
      await appendFile(${JSON.stringify(markerFile)}, JSON.stringify({ test: 'first', workerMarker }) + '\\n');
    },
    async teardown() {
      throw new Error('teardown failed on purpose');
    },
  }),
  test('uses replacement worker', async () => {
    await appendFile(${JSON.stringify(markerFile)}, JSON.stringify({ test: 'second', workerMarker }) + '\\n');
  }),
];
`);
        const result = spawnSync(process.execPath, [runnerPath, '--jobs=1', './teardown-failure.test.mjs'], {
            cwd: fixtureDirectory,
            encoding: 'utf8',
            env: process.env,
        });
        assert.equal(result.status, 1, 'teardown failure should exit non-zero');
        assert.match(result.stdout, /teardown failed/i);
        const lines = await readJsonLines(markerFile);
        assert.equal(lines.length, 2);
        assert.notEqual(lines[0].workerMarker, lines[1].workerMarker);
    },
}), test('forces worker termination after timeout grace and still runs remaining tests', {
    timeout: 15000,
    async run() {
        const tempDirectory = await mkdtemp(join(tmpdir(), 'section-tests-timeout-'));
        const markerFile = join(tempDirectory, 'progress.txt');
        const fixtureDirectory = await createFixtureFile('timeout-grace.test.mjs', `
import { appendFile } from 'node:fs/promises';
import { test } from ${JSON.stringify(sectionTestsImportUrl)};

const workerMarker = (globalThis.__sectionTestsWorkerMarker ??= Math.random().toString(16).slice(2));

export default [
  test('hangs forever', {
    timeout: 120,
    async run() {
      await appendFile(${JSON.stringify(markerFile)}, JSON.stringify({ test: 'first', workerMarker }) + '\\n');
      await new Promise(() => {
        setInterval(() => {}, 1000);
      });
    },
    async teardown() {
      await appendFile(${JSON.stringify(markerFile)}, JSON.stringify({ test: 'teardown', workerMarker }) + '\\n');
      await new Promise(() => {
        setInterval(() => {}, 1000);
      });
    },
  }),
  test('still runs', async () => {
    await appendFile(${JSON.stringify(markerFile)}, JSON.stringify({ test: 'second', workerMarker }) + '\\n');
  }),
];
`);
        const startedAt = Date.now();
        const result = spawnSync(process.execPath, [runnerPath, '--jobs=1', '--timeout-grace=300', './timeout-grace.test.mjs'], {
            cwd: fixtureDirectory,
            encoding: 'utf8',
            env: process.env,
        });
        const elapsedMs = Date.now() - startedAt;
        assert.equal(result.status, 1, 'timed out tests should exit non-zero');
        assert.match(result.stdout, /still runs/i);
        assert.match(result.stdout, /worker terminated after 300 ms grace/i);
        assert.ok(elapsedMs >= 300, `expected timeout grace to be respected, got ${elapsedMs}`);
        const lines = await readJsonLines(markerFile);
        assert.equal(lines[0].test, 'first');
        assert.equal(lines[1].test, 'teardown');
        assert.equal(lines[2].test, 'second');
        assert.notEqual(lines[0].workerMarker, lines[2].workerMarker);
    },
}), test('does not retire a worker after an ordinary test failure', {
    timeout: 15000,
    async run() {
        const markerFile = join(await mkdtemp(join(tmpdir(), 'section-tests-ordinary-failure-')), 'results.jsonl');
        const fixtureDirectory = await createFixtureFile('ordinary-failure.test.mjs', `
import assert from 'node:assert/strict';
import { appendFile } from 'node:fs/promises';
import { test } from ${JSON.stringify(sectionTestsImportUrl)};

const workerMarker = (globalThis.__sectionTestsWorkerMarker ??= Math.random().toString(16).slice(2));

export default [
  test('fails normally', async () => {
    await appendFile(${JSON.stringify(markerFile)}, JSON.stringify({ test: 'first', workerMarker }) + '\\n');
    assert.fail('ordinary failure');
  }),
  test('keeps same worker', async () => {
    await appendFile(${JSON.stringify(markerFile)}, JSON.stringify({ test: 'second', workerMarker }) + '\\n');
  }),
];
`);
        const result = spawnSync(process.execPath, [runnerPath, '--jobs=1', './ordinary-failure.test.mjs'], {
            cwd: fixtureDirectory,
            encoding: 'utf8',
            env: process.env,
        });
        assert.equal(result.status, 1, 'ordinary failure should exit non-zero');
        assert.match(result.stdout, /ordinary failure/i);
        const lines = await readJsonLines(markerFile);
        assert.equal(lines.length, 2);
        assert.equal(lines[0].workerMarker, lines[1].workerMarker);
    },
})), suite('Reporter', test('keeps detailed live mode for small suites', {
    async run() {
        const tests = [
            createCollectedTest('small-1', 'first detail', ['SmallSuite'], '/tmp/small-suite.test.mjs', 0),
            createCollectedTest('small-2', 'second detail', ['SmallSuite'], '/tmp/small-suite.test.mjs', 1),
        ];
        const { reporter, getLastFrame } = createReporterHarness({
            compactThreshold: 10,
            renderIntervalMs: 1,
        });
        reporter.onPlan(createPlan(tests));
        reporter.onEvent({
            type: 'test-started',
            ...eventBase(tests[0]),
            mode: 'parallel',
        });
        reporter.onEvent({
            type: 'phase-started',
            ...eventBase(tests[0]),
            phase: 'run',
        });
        await sleep(10);
        const frame = getLastFrame();
        assert.match(frame, /SmallSuite > first detail \[run\]/);
        assert.doesNotMatch(frame, /progress \d+\/\d+ finished/i);
    },
}), test('switches to compact suite summaries for larger suites', {
    async run() {
        const tests = [
            createCollectedTest('compact-1', 'completed case', ['FastifyServer'], '/tmp/fastify.test.mjs', 0),
            createCollectedTest('compact-2', 'fastify waiting', ['FastifyServer'], '/tmp/fastify.test.mjs', 1),
            createCollectedTest('compact-3', 'running case', ['JWT'], '/tmp/jwt.test.mjs', 0),
            createCollectedTest('compact-4', 'jwt waiting', ['JWT'], '/tmp/jwt.test.mjs', 1),
        ];
        const { reporter, getLastFrame } = createReporterHarness({
            compactThreshold: 2,
            renderIntervalMs: 1,
            maxRunningTests: 2,
        });
        reporter.onPlan(createPlan(tests));
        reporter.onEvent({
            type: 'test-started',
            ...eventBase(tests[0]),
            mode: 'parallel',
        });
        reporter.onEvent({
            type: 'test-finished',
            ...eventBase(tests[0]),
            status: 'passed',
            durationMs: 45,
            prepareDurationMs: 5,
            teardownStatus: 'not-needed',
        });
        reporter.onEvent({
            type: 'test-started',
            ...eventBase(tests[2]),
            mode: 'parallel',
        });
        reporter.onEvent({
            type: 'phase-started',
            ...eventBase(tests[2]),
            phase: 'run',
        });
        await sleep(10);
        const frame = getLastFrame();
        assert.match(frame, /progress 1\/4 finished \| running 1 \| failed 0/i);
        assert.match(frame, /FastifyServer 1\/2 \| 0 running \| 1 passed/i);
        assert.match(frame, /JWT 0\/2 \| 1 running \| 0 passed/i);
        assert.match(frame, /running now/i);
        assert.match(frame, /JWT > running case \[run\]/i);
        assert.doesNotMatch(frame, /completed case/i);
    },
}), test('throttles redraw bursts in interactive mode', {
    async run() {
        const tests = [
            createCollectedTest('throttle-1', 'first throttle', ['ThrottleSuite'], '/tmp/throttle.test.mjs', 0),
            createCollectedTest('throttle-2', 'second throttle', ['ThrottleSuite'], '/tmp/throttle.test.mjs', 1),
        ];
        const { reporter, frames, getDoneCalls } = createReporterHarness({
            compactThreshold: 10,
            renderIntervalMs: 20,
        });
        reporter.onPlan(createPlan(tests));
        reporter.onEvent({
            type: 'test-started',
            ...eventBase(tests[0]),
            mode: 'parallel',
        });
        reporter.onEvent({
            type: 'phase-started',
            ...eventBase(tests[0]),
            phase: 'setup',
        });
        reporter.onEvent({
            type: 'phase-finished',
            ...eventBase(tests[0]),
            phase: 'setup',
        });
        reporter.onEvent({
            type: 'phase-started',
            ...eventBase(tests[0]),
            phase: 'run',
        });
        reporter.onEvent({
            type: 'test-started',
            ...eventBase(tests[1]),
            mode: 'parallel',
        });
        reporter.onEvent({
            type: 'phase-started',
            ...eventBase(tests[1]),
            phase: 'run',
        });
        await sleep(35);
        assert.equal(frames.length, 1, `expected a single coalesced render, got ${frames.length}`);
        reporter.flush();
        assert.equal(getDoneCalls(), 1);
        assert.equal(frames.length, 2, `expected final flush render, got ${frames.length}`);
    },
}), test('preserves final summary and failure details in both live modes', {
    async run() {
        const detailedTest = createCollectedTest('summary-detailed', 'broken detail', ['DetailSuite'], '/tmp/detail.test.mjs', 0);
        const compactTests = [
            createCollectedTest('summary-compact-1', 'broken compact', ['CompactSuite'], '/tmp/compact.test.mjs', 0),
            createCollectedTest('summary-compact-2', 'other compact', ['CompactSuite'], '/tmp/compact.test.mjs', 1),
        ];
        const detailedReporter = createReporterHarness({
            compactThreshold: 10,
        }).reporter;
        detailedReporter.onPlan(createPlan([detailedTest]));
        detailedReporter.onSummary({
            ok: 0,
            failed: 1,
            total: 1,
            durationMs: 125,
            pass: false,
            records: [{
                    test: detailedTest,
                    events: [],
                    status: 'failed',
                    durationMs: 10,
                    prepareDurationMs: 5,
                    failure: {
                        name: 'Error',
                        message: 'detailed boom',
                        stack: 'Error: detailed boom\n    at detail.test.mjs:1:1',
                    },
                    failurePhase: 'run',
                    teardownStatus: 'not-needed',
                }],
        });
        const detailedLogs = await captureConsoleLogs(() => {
            detailedReporter.flush();
        });
        assert.match(detailedLogs.join('\n'), /1 \/ 1 tests failed!/i);
        assert.match(detailedLogs.join('\n'), /run: broken detail - detailed boom/i);
        const compactReporter = createReporterHarness({
            compactThreshold: 1,
        }).reporter;
        compactReporter.onPlan(createPlan(compactTests));
        compactReporter.onSummary({
            ok: 1,
            failed: 1,
            total: 2,
            durationMs: 240,
            pass: false,
            records: [
                {
                    test: compactTests[0],
                    events: [],
                    status: 'failed',
                    durationMs: 30,
                    prepareDurationMs: 6,
                    failure: {
                        name: 'Error',
                        message: 'compact boom',
                        stack: 'Error: compact boom\n    at compact.test.mjs:1:1',
                    },
                    failurePhase: 'run',
                    teardownStatus: 'not-needed',
                },
                {
                    test: compactTests[1],
                    events: [],
                    status: 'passed',
                    durationMs: 20,
                    prepareDurationMs: 4,
                    teardownStatus: 'not-needed',
                },
            ],
        });
        const compactLogs = await captureConsoleLogs(() => {
            compactReporter.flush();
        });
        assert.match(compactLogs.join('\n'), /1 \/ 2 tests failed!/i);
        assert.match(compactLogs.join('\n'), /run: broken compact - compact boom/i);
    },
})));
//# sourceMappingURL=main.js.map