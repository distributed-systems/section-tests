import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { defineTests, serial, suite, test } from '../index.js';

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
                assert.match(result.stdout, /avg\/test .* \| load .* \| total .* \| avg parallelism/i);

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

        test('attempts teardown after a run timeout', {
            timeout: 15_000,
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
                assert.match(result.stdout, /\[timeout run 120 ms, teardown completed\]/i);
                assert.match(result.stdout, /teardown completed/i);

                const markerContents = await readFile(markerFile, 'utf8');
                assert.match(markerContents, /teardown-completed/);
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
                assert.equal(lines[0].test, 'first');
                assert.equal(lines[1].test, 'teardown');
                assert.equal(lines[2].test, 'second');
                assert.notEqual(lines[0].workerMarker, lines[2].workerMarker);
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
);

