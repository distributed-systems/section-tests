import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { defineTests, serial, suite, test } from '../index.js';
import SpecReporter from '../src/SpecReporter.js';
import type { CollectedTest, TestExecutionRecord, TestPlan } from '../src/runtime-types.js';

const rootDirectory = fileURLToPath(new URL('../..', import.meta.url));
const sectionTestsImportUrl = pathToFileURL(join(rootDirectory, 'dist', 'index.js')).href;
const runnerPath = join(rootDirectory, 'dist', 'bin', 'run.js');
const JSON_SUMMARY_PREFIX = 'SECTION_TESTS_SUMMARY:';

async function createFixtureFile(name: string, content: string): Promise<string> {
    const tempDirectory = await mkdtemp(join(tmpdir(), 'section-tests-runner-'));
    const testFilePath = join(tempDirectory, name);
    await writeFile(testFilePath, content, 'utf8');
    return tempDirectory;
}

async function readJsonLines(path: string): Promise<any[]> {
    const contents = await readFile(path, 'utf8');
    return contents
        .trim()
        .split('\n')
        .filter((line) => line.trim().length > 0)
        .map((line) => JSON.parse(line));
}

function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

function stripAnsi(text: string): string {
    return text
        .replace(/\u001B\[[0-9;?]*[ -/]*[@-~]/g, '')
        .replace(/\u001B\][^\u0007]*(\u0007|\u001B\\)/g, '');
}

function createCollectedTest(
    id: string,
    name: string,
    suitePath: string[],
    file: string,
    entryPath: number,
): CollectedTest {
    return {
        id,
        file,
        name,
        suitePath,
        mode: 'parallel',
        timeout: 1_000,
        entryPath: [entryPath],
        source: {
            hasSetup: false,
            hasTeardown: false,
        },
    };
}

function createPlan(tests: CollectedTest[]): TestPlan {
    return {
        files: Array.from(new Set(tests.map((test) => test.file))),
        tests,
    };
}

function eventBase(test: CollectedTest, workerId = 'worker-1', workerSlot = 1) {
    return {
        workerId,
        workerSlot,
        testId: test.id,
        file: test.file,
        suitePath: test.suitePath,
        testName: test.name,
    };
}

function createReporterHarness({
    renderIntervalMs = 5,
    workerSlots = 2,
    showTestLogs = false,
}: {
    renderIntervalMs?: number;
    workerSlots?: number;
    showTestLogs?: boolean;
} = {}) {
    const frames: string[] = [];
    let doneCalls = 0;
    let clearCalls = 0;
    const output = {
        isTTY: true,
        // Absorb run-header and log-update output so we never fall back to console and corrupt
        // the real TTY when parallel tests use this harness.
        write(_chunk: string | Uint8Array) {
            return true;
        },
    } as NodeJS.WriteStream;
    const renderer = ((message: string) => {
        frames.push(stripAnsi(message));
    }) as ((message: string) => void) & { done: () => void; clear: () => void };
    renderer.done = () => {
        doneCalls += 1;
    };
    renderer.clear = () => {
        clearCalls += 1;
    };

    const reporter = new SpecReporter({
        interactive: true,
        renderIntervalMs,
        workerSlots,
        output,
        showTestLogs,
        createRenderer: () => renderer,
    });

    return {
        reporter,
        frames,
        getLastFrame: () => frames[frames.length - 1] || '',
        getDoneCalls: () => doneCalls,
        getClearCalls: () => clearCalls,
    };
}

async function captureConsoleLogs(execute: () => void | Promise<void>): Promise<string[]> {
    const originalConsoleLog = console.log;
    const lines: string[] = [];
    console.log = (...args: unknown[]) => {
        lines.push(stripAnsi(args.map((value) => String(value)).join(' ')));
    };

    try {
        await execute();
    } finally {
        console.log = originalConsoleLog;
    }

    return lines;
}

export default defineTests(
    suite(
        'API',
        test('passes setup results into run and teardown', {
            async setup(context) {
                context.info('creating setup payload');
                return { counter: 1 };
            },

            async run(payload: { counter: number }) {
                assert.equal(payload.counter, 1);
                payload.counter = 2;
            },

            async teardown(payload: { counter: number }) {
                assert.equal(payload.counter, 2);
            },
        }),
    ),

    suite(
        'CLI',
        test('runs tests in parallel with isolated runtime state', {
            timeout: 15_000,
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
                const result = spawnSync(
                    process.execPath,
                    [runnerPath, '--jobs=2', './parallel.test.mjs'],
                    {
                        cwd: fixtureDirectory,
                        encoding: 'utf8',
                        env: process.env,
                    },
                );
                const elapsedMs = Date.now() - startedAt;

                assert.equal(result.status, 0, result.stderr || result.stdout);
                assert.match(result.stdout, /first/i);
                assert.match(result.stdout, /second/i);
                assert.ok(elapsedMs < 1_000, `expected parallel run under 1000ms, got ${elapsedMs}`);

                const lines = (await readFile(markerFile, 'utf8')).trim().split('\n').map((line) => JSON.parse(line));
                assert.equal(lines.length, 2);
                assert.notEqual(lines[0].id, lines[1].id);
            },
        }),

        test('reuses a clean worker without reimporting the file', {
            timeout: 15_000,
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

                const result = spawnSync(
                    process.execPath,
                    [runnerPath, '--jobs=1', './reuse.test.mjs'],
                    {
                        cwd: fixtureDirectory,
                        encoding: 'utf8',
                        env: process.env,
                    },
                );

                assert.equal(result.status, 0, result.stderr || result.stdout);
                assert.match(
                    result.stdout,
                    /Test Files.*\n.*Tests.*\n.*Duration.+\(load .*, tests .*, total .*, parallel/i,
                );

                const lines = await readJsonLines(markerFile);
                assert.equal(lines.length, 2);
                assert.equal(lines[0].workerMarker, lines[1].workerMarker);
                assert.equal(lines[0].importCount, 1);
                assert.equal(lines[1].importCount, 1);
            },
        }),

        test('keeps serial tests exclusive when requested', {
            timeout: 15_000,
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
                const result = spawnSync(
                    process.execPath,
                    [runnerPath, '--jobs=4', './serial.test.mjs'],
                    {
                        cwd: fixtureDirectory,
                        encoding: 'utf8',
                        env: process.env,
                    },
                );
                const elapsedMs = Date.now() - startedAt;

                assert.equal(result.status, 0, result.stderr || result.stdout);
                assert.ok(elapsedMs >= 450, `expected serial run to take at least 450ms, got ${elapsedMs}`);
            },
        }),

        test('emits machine-readable suite summary when enabled', {
            timeout: 15_000,
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

                const result = spawnSync(
                    process.execPath,
                    [runnerPath, '--json-summary', './failure.test.mjs'],
                    {
                        cwd: fixtureDirectory,
                        encoding: 'utf8',
                        env: process.env,
                    },
                );

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
        }),

        test('uses runner default timeout for tests without per-test timeout', {
            timeout: 15_000,
            async run() {
                const fixtureDirectory = await createFixtureFile('default-timeout.test.mjs', `
import { test } from ${JSON.stringify(sectionTestsImportUrl)};

export default [
  test('uses default timeout', async () => {
    await new Promise(() => {});
  }),
];
`);

                const result = spawnSync(
                    process.execPath,
                    [runnerPath, '--timeout=100', '--timeout-grace=200', './default-timeout.test.mjs'],
                    {
                        cwd: fixtureDirectory,
                        encoding: 'utf8',
                        env: process.env,
                    },
                );

                assert.equal(result.status, 1, 'timed out tests should exit non-zero');
                assert.match(result.stdout, /timed out after 100 milliseconds/i);
            },
        }),

        test('runs teardown if the timed-out `run` promise settles within 2× the test timeout', {
            timeout: 15_000,
            async run() {
                const tempDirectory = await mkdtemp(join(tmpdir(), 'section-tests-timeout-'));
                const markerFile = join(tempDirectory, 'teardown.txt');
                const fixtureDirectory = await createFixtureFile('timeout-teardown-settles.test.mjs', `
import { appendFile } from 'node:fs/promises';
import { test } from ${JSON.stringify(sectionTestsImportUrl)};

export default [
  test('long run then cleanup', {
    timeout: 100,
    async setup() {
      return ${JSON.stringify(markerFile)};
    },
    async run() {
      await new Promise((r) => setTimeout(r, 150));
    },
    async teardown(marker) {
      await appendFile(marker, 'teardown-completed\\n');
    },
  }),
];
`);

                const result = spawnSync(
                    process.execPath,
                    [runnerPath, './timeout-teardown-settles.test.mjs'],
                    {
                        cwd: fixtureDirectory,
                        encoding: 'utf8',
                        env: process.env,
                    },
                );

                assert.equal(result.status, 1, 'timed out tests should exit non-zero');
                assert.doesNotMatch(result.stdout, /teardown skipped/i);
                const markerContents = await readFile(markerFile, 'utf8');
                assert.match(markerContents, /teardown-completed/);
            },
        }),

        test('skips teardown when run is still pending after 2× timeout quiesce', {
            timeout: 15_000,
            async run() {
                const tempDirectory = await mkdtemp(join(tmpdir(), 'section-tests-timeout-'));
                const markerFile = join(tempDirectory, 'teardown.txt');
                const fixtureDirectory = await createFixtureFile('timeout-teardown.test.mjs', `
import { appendFile } from 'node:fs/promises';
import { test } from ${JSON.stringify(sectionTestsImportUrl)};

export default [
  test('times out and never settles', {
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

                const result = spawnSync(
                    process.execPath,
                    [runnerPath, '--timeout-grace=240', './timeout-teardown.test.mjs'],
                    {
                        cwd: fixtureDirectory,
                        encoding: 'utf8',
                        env: process.env,
                    },
                );

                assert.equal(result.status, 1, 'timed out tests should exit non-zero');
                assert.match(result.stdout, /teardown skipped/i);
                assert.match(result.stdout, /timeout run 120 ms/i);
                assert.doesNotMatch(result.stdout, /teardown-completed/i);

                await assert.rejects(() => readFile(markerFile, 'utf8'), { code: 'ENOENT' });
            },
        }),

        test('retires a worker after teardown failure and replaces it', {
            timeout: 15_000,
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

                const result = spawnSync(
                    process.execPath,
                    [runnerPath, '--jobs=1', './teardown-failure.test.mjs'],
                    {
                        cwd: fixtureDirectory,
                        encoding: 'utf8',
                        env: process.env,
                    },
                );

                assert.equal(result.status, 1, 'teardown failure should exit non-zero');
                assert.match(result.stdout, /teardown failed/i);

                const lines = await readJsonLines(markerFile);
                assert.equal(lines.length, 2);
                assert.notEqual(lines[0].workerMarker, lines[1].workerMarker);
            },
        }),

        test('forces worker termination after timeout grace and still runs remaining tests', {
            timeout: 15_000,
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
                const result = spawnSync(
                    process.execPath,
                    [runnerPath, '--jobs=1', '--timeout-grace=300', './timeout-grace.test.mjs'],
                    {
                        cwd: fixtureDirectory,
                        encoding: 'utf8',
                        env: process.env,
                    },
                );
                const elapsedMs = Date.now() - startedAt;

                assert.equal(result.status, 1, 'timed out tests should exit non-zero');
                assert.match(result.stdout, /still runs/i);
                assert.match(result.stdout, /worker terminated after 300 ms grace/i);
                assert.ok(elapsedMs >= 300, `expected timeout grace to be respected, got ${elapsedMs}`);

                const lines = await readJsonLines(markerFile);
                assert.equal(lines.length, 2, 'run timeout skips teardown; expect first + second test only');
                assert.equal(lines[0].test, 'first');
                assert.equal(lines[1].test, 'second');
                assert.notEqual(lines[0].workerMarker, lines[1].workerMarker);
            },
        }),

        test('does not retire a worker after an ordinary test failure', {
            timeout: 15_000,
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

                const result = spawnSync(
                    process.execPath,
                    [runnerPath, '--jobs=1', './ordinary-failure.test.mjs'],
                    {
                        cwd: fixtureDirectory,
                        encoding: 'utf8',
                        env: process.env,
                    },
                );

                assert.equal(result.status, 1, 'ordinary failure should exit non-zero');
                assert.match(result.stdout, /ordinary failure/i);

                const lines = await readJsonLines(markerFile);
                assert.equal(lines.length, 2);
                assert.equal(lines[0].workerMarker, lines[1].workerMarker);
            },
        }),
    ),

    suite(
        'Reporter',
        test('prints a run header as the first output in interactive mode', {
            async run() {
                const written: string[] = [];
                const output = {
                    isTTY: true,
                    write(chunk: string | Uint8Array) {
                        written.push(typeof chunk === 'string' ? chunk : new TextDecoder().decode(chunk));
                    },
                } as NodeJS.WriteStream;
                const frames: string[] = [];
                const renderer = ((message: string) => {
                    frames.push(stripAnsi(message));
                }) as ((message: string) => void) & { done: () => void; clear: () => void };
                renderer.done = () => {};
                renderer.clear = () => {};

                const reporter = new SpecReporter({
                    interactive: true,
                    output,
                    renderIntervalMs: 0,
                    workerSlots: 1,
                    createRenderer: () => renderer,
                });
                const testCase = createCollectedTest('hdr-1', 'h', ['HdrSuite'], '/tmp/hdr.test.mjs', 0);
                reporter.onPlan(createPlan([testCase]));
                await new Promise<void>((resolve) => queueMicrotask(() => resolve()));

                assert.ok(written.length > 0, 'expected a write before the live board');
                const header = written[0]!;
                assert.match(stripAnsi(header), /RUN/);
                assert.match(header, /v\d+\.\d+\.\d+/);
                assert.ok(
                    stripAnsi(header).includes(process.cwd()),
                    'expected run header to include the working directory',
                );
                assert.equal(frames.length, 1, 'progress is rendered through log-update; run header is still written only to output');
                assert.match(frames[0] || '', /0\/1/);
            },
        }),

        test('shows no worker lines before any slot has received work', {
            async run() {
                const tests = [
                    createCollectedTest('slot-1', 'first slot test', ['SlotSuite'], '/tmp/slot-suite.test.mjs', 0),
                    createCollectedTest('slot-2', 'second slot test', ['SlotSuite'], '/tmp/slot-suite.test.mjs', 1),
                ];
                const { reporter, getLastFrame } = createReporterHarness({
                    renderIntervalMs: 1,
                    workerSlots: 2,
                });

                reporter.onPlan(createPlan(tests));
                await sleep(10);

                const frame = getLastFrame();
                assert.match(frame, /0\/2/);
                assert.doesNotMatch(frame, /^\d{2} (…|✔|✖)/m);
            },
        }),

        test('shows current work on the matching worker line', {
            async run() {
                const tests = [
                    createCollectedTest('busy-1', 'first worker test', ['BusySuite'], '/tmp/busy-suite.test.mjs', 0),
                    createCollectedTest('busy-2', 'second worker test', ['BusySuite'], '/tmp/busy-suite.test.mjs', 1),
                ];
                const { reporter, getLastFrame } = createReporterHarness({
                    renderIntervalMs: 1,
                    workerSlots: 2,
                });

                reporter.onPlan(createPlan(tests));
                reporter.onEvent({
                    type: 'test-started',
                    ...eventBase(tests[0], 'worker-1', 1),
                    mode: 'parallel',
                });
                reporter.onEvent({
                    type: 'phase-started',
                    ...eventBase(tests[0], 'worker-1', 1),
                    phase: 'run',
                });
                reporter.onEvent({
                    type: 'test-started',
                    ...eventBase(tests[1], 'worker-2', 2),
                    mode: 'parallel',
                });
                reporter.onEvent({
                    type: 'phase-started',
                    ...eventBase(tests[1], 'worker-2', 2),
                    phase: 'run',
                });

                await sleep(10);

                const lines = getLastFrame().split('\n');
                assert.equal(lines.length, 4);
                assert.match(lines[0], /0\/2/);
                assert.equal(lines[1], '');
                assert.match(lines[2], /^01 … BusySuite > first worker test \[run\]$/);
                assert.match(lines[3], /^02 … BusySuite > second worker test \[run\]$/);
            },
        }),

        test('keeps the last completed result visible while a worker is idle', {
            async run() {
                const tests = [
                    createCollectedTest('idle-1', 'finished on worker one', ['IdleSuite'], '/tmp/idle-suite.test.mjs', 0),
                    createCollectedTest('idle-2', 'still running on worker two', ['IdleSuite'], '/tmp/idle-suite.test.mjs', 1),
                ];
                const { reporter, getLastFrame } = createReporterHarness({
                    renderIntervalMs: 1,
                    workerSlots: 2,
                });

                reporter.onPlan(createPlan(tests));
                reporter.onEvent({
                    type: 'test-started',
                    ...eventBase(tests[0], 'worker-1', 1),
                    mode: 'parallel',
                });
                reporter.onEvent({
                    type: 'test-finished',
                    ...eventBase(tests[0], 'worker-1', 1),
                    status: 'passed',
                    durationMs: 42,
                    prepareDurationMs: 5,
                    teardownStatus: 'not-needed',
                });
                reporter.onEvent({
                    type: 'test-started',
                    ...eventBase(tests[1], 'worker-2', 2),
                    mode: 'parallel',
                });
                reporter.onEvent({
                    type: 'phase-started',
                    ...eventBase(tests[1], 'worker-2', 2),
                    phase: 'run',
                });

                await sleep(10);

                const lines = getLastFrame().split('\n');
                assert.equal(lines.length, 4);
                assert.match(lines[0], /1\/2/);
                assert.equal(lines[1], '');
                assert.match(lines[2], /^01 ✔ IdleSuite > finished on worker one$/);
                assert.match(lines[3], /^02 … IdleSuite > still running on worker two \[run\]$/);
            },
        }),

        test('reuses the same slot line for replacement workers', {
            async run() {
                const tests = [
                    createCollectedTest('replace-1', 'times out on first worker', ['ReplaceSuite'], '/tmp/replace-suite.test.mjs', 0),
                    createCollectedTest('replace-2', 'runs on replacement worker', ['ReplaceSuite'], '/tmp/replace-suite.test.mjs', 1),
                ];
                const { reporter, getLastFrame } = createReporterHarness({
                    renderIntervalMs: 1,
                    workerSlots: 2,
                });

                reporter.onPlan(createPlan(tests));
                reporter.onEvent({
                    type: 'test-started',
                    ...eventBase(tests[0], 'worker-1', 1),
                    mode: 'parallel',
                });
                reporter.onEvent({
                    type: 'test-finished',
                    ...eventBase(tests[0], 'worker-1', 1),
                    status: 'failed',
                    durationMs: 0,
                    prepareDurationMs: 0,
                    failure: {
                        name: 'TimeoutError',
                        message: 'timed out',
                    },
                    failurePhase: 'run',
                    timeout: {
                        phase: 'run',
                        timeoutMs: 100,
                    },
                    teardownStatus: 'not-needed',
                    workerTermination: {
                        forced: true,
                        reason: 'timeout-grace-expired',
                        graceMs: 200,
                    },
                });
                await sleep(10);

                let lines = getLastFrame().split('\n');
                assert.equal(lines.length, 3);
                assert.match(lines[0], /1\/2/);
                assert.equal(lines[1], '');
                assert.match(lines[2], /^01 ✖ ReplaceSuite > times out on first worker \[timeout run 100 ms, killed after 200 ms grace\] \[replacing worker\]$/);

                reporter.onEvent({
                    type: 'test-started',
                    ...eventBase(tests[1], 'worker-9', 1),
                    mode: 'parallel',
                });
                reporter.onEvent({
                    type: 'phase-started',
                    ...eventBase(tests[1], 'worker-9', 1),
                    phase: 'run',
                });

                await sleep(10);

                lines = getLastFrame().split('\n');
                assert.equal(lines.length, 3);
                assert.match(lines[0], /1\/2/);
                assert.equal(lines[1], '');
                assert.match(lines[2], /^01 … ReplaceSuite > runs on replacement worker \[run\]$/);
            },
        }),

        test('throttles redraw bursts in interactive mode', {
            async run() {
                const tests = [
                    createCollectedTest('throttle-1', 'first throttle', ['ThrottleSuite'], '/tmp/throttle.test.mjs', 0),
                    createCollectedTest('throttle-2', 'second throttle', ['ThrottleSuite'], '/tmp/throttle.test.mjs', 1),
                ];
                const { reporter, frames, getClearCalls, getDoneCalls } = createReporterHarness({
                    renderIntervalMs: 20,
                    workerSlots: 2,
                });

                reporter.onPlan(createPlan(tests));
                reporter.onEvent({
                    type: 'test-started',
                    ...eventBase(tests[0], 'worker-1', 1),
                    mode: 'parallel',
                });
                reporter.onEvent({
                    type: 'phase-started',
                    ...eventBase(tests[0], 'worker-1', 1),
                    phase: 'run',
                });
                reporter.onEvent({
                    type: 'test-started',
                    ...eventBase(tests[1], 'worker-2', 2),
                    mode: 'parallel',
                });
                reporter.onEvent({
                    type: 'phase-started',
                    ...eventBase(tests[1], 'worker-2', 2),
                    phase: 'run',
                });
                reporter.onEvent({
                    type: 'phase-finished',
                    ...eventBase(tests[1], 'worker-2', 2),
                    phase: 'run',
                });

                await sleep(35);
                assert.equal(frames.length, 1, `expected one coalesced update, got ${frames.length}`);

                reporter.flush();
                assert.equal(getClearCalls(), 0);
                assert.equal(getDoneCalls(), 1);
                assert.equal(frames.length, 2, `expected final persistent render after flush, got ${frames.length}`);
            },
        }),

        test('preserves final summary and leaves the live board visible on flush', {
            async run() {
                const testCase = createCollectedTest('summary-slot', 'broken slot', ['SummarySuite'], '/tmp/summary-suite.test.mjs', 0);
                const harness = createReporterHarness({
                    renderIntervalMs: 1,
                    workerSlots: 1,
                });

                harness.reporter.onPlan(createPlan([testCase]));
                harness.reporter.onEvent({
                    type: 'test-started',
                    ...eventBase(testCase, 'worker-1', 1),
                    mode: 'parallel',
                });
                harness.reporter.onSummary({
                    ok: 0,
                    failed: 1,
                    total: 1,
                    durationMs: 125,
                    pass: false,
                    records: [{
                        test: testCase,
                        events: [],
                        status: 'failed',
                        durationMs: 10,
                        prepareDurationMs: 5,
                        failure: {
                            name: 'Error',
                            message: 'slot boom',
                            stack: 'Error: slot boom\n    at summary.test.mjs:1:1',
                        },
                        failurePhase: 'run',
                        teardownStatus: 'not-needed',
                    } satisfies TestExecutionRecord],
                });

                const logs = await captureConsoleLogs(() => {
                    harness.reporter.flush();
                });

                assert.equal(harness.getClearCalls(), 0);
                assert.equal(harness.getDoneCalls(), 1);
                assert.match(logs.join('\n'), /1 \/ 1 tests failed!/i);
                assert.match(logs.join('\n'), /run: broken slot - slot boom/i);
            },
        }),

        test('buffers context test-log in interactive mode and prints after flush when showTestLogs', {
            async run() {
                const testCase = createCollectedTest('log-buf', 'with log', ['LogBuf'], '/tmp/log-buf.test.mjs', 0);
                const harness = createReporterHarness({
                    renderIntervalMs: 1,
                    workerSlots: 1,
                    showTestLogs: true,
                });

                harness.reporter.onPlan(createPlan([testCase]));
                harness.reporter.onEvent({
                    type: 'test-log',
                    ...eventBase(testCase, 'worker-1', 1),
                    level: 'info',
                    message: 'structured line',
                });
                harness.reporter.onSummary({
                    ok: 1,
                    failed: 0,
                    total: 1,
                    durationMs: 50,
                    pass: true,
                    records: [{
                        test: testCase,
                        events: [],
                        status: 'passed',
                        durationMs: 10,
                        prepareDurationMs: 0,
                        teardownStatus: 'not-needed',
                    } satisfies TestExecutionRecord],
                });

                const logs = await captureConsoleLogs(() => {
                    harness.reporter.flush();
                });

                assert.match(logs.join('\n'), /Test log \(from context\)/i);
                assert.match(logs.join('\n'), /structured line/);
                assert.match(logs.join('\n'), /LogBuf > with log/);
            },
        }),

        test('does not print buffered test-log at end when showTestLogs is off', {
            async run() {
                const testCase = createCollectedTest('log-off', 'no tail log', ['LogOff'], '/tmp/log-off.test.mjs', 0);
                const harness = createReporterHarness({
                    renderIntervalMs: 1,
                    workerSlots: 1,
                    showTestLogs: false,
                });

                harness.reporter.onPlan(createPlan([testCase]));
                harness.reporter.onEvent({
                    type: 'test-log',
                    ...eventBase(testCase, 'worker-1', 1),
                    level: 'info',
                    message: 'should not appear in flush output',
                });
                harness.reporter.onSummary({
                    ok: 1,
                    failed: 0,
                    total: 1,
                    durationMs: 10,
                    pass: true,
                    records: [{
                        test: testCase,
                        events: [],
                        status: 'passed',
                        durationMs: 1,
                        prepareDurationMs: 0,
                        teardownStatus: 'not-needed',
                    } satisfies TestExecutionRecord],
                });

                const logs = await captureConsoleLogs(() => {
                    harness.reporter.flush();
                });

                assert.doesNotMatch(logs.join('\n'), /Test log \(from context\)/i);
            },
        }),

        test('prints test-log when not interactive and showTestLogs is on', {
            async run() {
                const testCase = createCollectedTest('log-ni', 'ni', ['Ni'], '/tmp/ni.test.mjs', 0);
                const reporter = new SpecReporter({
                    interactive: false,
                    output: { isTTY: false } as NodeJS.WriteStream,
                    showTestLogs: true,
                });
                reporter.onPlan(createPlan([testCase]));
                const logs = await captureConsoleLogs(() => {
                    reporter.onEvent({
                        type: 'test-log',
                        ...eventBase(testCase, 'worker-1', 1),
                        level: 'warn',
                        message: 'immediate',
                    });
                });
                assert.match(logs.join('\n'), /immediate/);
            },
        }),
    ),
);

