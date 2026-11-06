# section-tests

`section-tests` is now a parallel-first test runner for Node.js. Tests are collected first, then executed as isolated jobs across workers. Reuse lives in plain JavaScript helper functions, while runtime state stays per test by default.

## Install

```bash
npm i --save-dev section-tests
```

Add a script:

```json
{
  "scripts": {
    "test": "section ./test/**/*.test.mjs"
  }
}
```

## CLI

The `section` command comes from the package `bin` field (same behavior as `node dist/bin/run-npm.js` in this repo, or `node dist/bin/run.js` after a build).

Everything that is **not** a known flag and does not start with `-` is treated as a **test file pattern** (glob or path), in order, and passed to the runner.

### Flags

Each option accepts either `--name=value` or `--name value` (the value must be the next argv token for the spaced form).

| Flag | Env | Meaning |
|------|-----|---------|
| `--jobs=<n>` | — | Maximum parallel workers. If omitted, the runner uses `availableParallelism()` (at least 1). |
| `--timeout=<ms>` | — | Default timeout in milliseconds for tests that do not set their own `timeout`. If omitted, the runner default applies (currently 2000 ms). |
| `--timeout-grace=<ms>` | — | After a phase timeout, how long the worker may keep running before the parent force-terminates it if cleanup is still stuck. If omitted, the runner uses twice the configured default test timeout (`--timeout` / `defaultTimeoutMs`, default 2000 ms). |
| `--json-summary` | `SECTION_TESTS_JSON_SUMMARY=1` | Emit one machine-readable JSON line on **stderr** when the suite ends, prefixed with `SECTION_TESTS_SUMMARY:` (see `SECTION_TESTS_JSON_SUMMARY_PREFIX` in the API). |
| `--test-logs` | `SECTION_TESTS_TEST_LOGS=1` | After the run, print buffered `context` / test-log output from tests (by default the interactive reporter hides these until the end; this flag turns them on). Workers also register a **`logd`** sink when this flag is set (if `logd` is installed) so library logs become `test-log` events instead of bypassing the runner. **Without `--test-logs` or `--agent-output`, `logd` is not hooked** in workers. If `logd` is not installed, workers continue normally. |
| `--agent-output` | `SECTION_TESTS_AGENT_OUTPUT=1` | Use **`AgentPlainReporter`** instead of the default TTY board: colored, readable text—plan grouped by file and suite, then **one grouped section per test when it finishes** (phases, `context.*` logs, and **`logd`** lines—workers hook `logd` whenever this flag or `--test-logs` is on—all indented under that test, not interleaved across workers). No box-drawing rules; ends with a color summary. Good for humans, scripts, and AI agents. The default interactive UI is unchanged when this flag is off. If you construct **`TestRunner`** with an explicit `reporters` array, the CLI flag does not apply—add **`new AgentPlainReporter()`** yourself if you want this format. |

Boolean flags (`--json-summary`, `--test-logs`, `--agent-output`) are presence-only; there is no `--no-*` form in the CLI parser.

Example:

```bash
section './test/**/*.test.mjs' --jobs=4 --timeout=5000 --test-logs
```

**Refreshing the bundled `logd`:** `package.json` lists `logd` as a plain semver (`5.2.0`). The resolved package is the tarball under `vendor/logd-5.2.0.tgz` (see `package-lock.json`). To upgrade: bump and build `logd`, run `npm pack --pack-destination ../section-tests/vendor` from the `logd` package, update the semver and filename in `package.json` if the version changed, run `npm install ./vendor/logd-<version>.tgz`, then set the dependency back to semver-only and run `npm ci` to refresh the lockfile.

## Basic Usage

```ts
import { defineTests, suite, test } from 'section-tests';

export default defineTests(
  suite(
    'math',
    test('adds values', async () => {
      if (1 + 1 !== 2) throw new Error('math is broken');
    }),
  ),
);
```

## Setup, Run, Teardown

Use `setup -> run -> teardown` when a test needs runtime state. The setup result belongs to that test execution only.

```ts
import { test } from 'section-tests';

async function createUsersDb() {
  const db = await createTestDatabase();
  await db.migrate();
  return db;
}

async function disposeUsersDb(db) {
  await db.close();
}

export default [
  test('creates a user', {
    async setup() {
      return await createUsersDb();
    },

    async run(db, t) {
      await db.insertUser({ id: 'u1', name: 'Lina' });
      t.success('user created');
    },

    async teardown(db) {
      await disposeUsersDb(db);
    },
  }),
];
```

## Reusable Code, Fresh Runtime

To avoid duplication, share helper code instead of sharing live fixture instances:

```ts
import { test } from 'section-tests';

function dbTest(name, params, run) {
  return test(name, {
    async setup() {
      return await createUsersDb(params);
    },
    async run(db, context) {
      await run(db, context);
    },
    async teardown(db) {
      await disposeUsersDb(db);
    },
  });
}
```

## Serial Tests

Tests are parallel by default. Use `serial(...)` only when something truly cannot run concurrently.

```ts
import { serial } from 'section-tests';

export default [
  serial('touches a global resource', async () => {
    await doExclusiveWork();
  }),
];
```

## Timeouts And Cleanup

Each test may define its own `timeout`. If it does not, the runner default is used.

When a phase times out:
- the test is marked failed immediately
- the test context `AbortSignal` is aborted
- if `setup()` completed, `teardown()` is still attempted
- `teardown()` gets the same timeout budget as the original test
- if the worker is still alive after the grace window, the parent force-terminates it

That means cleanup is best-effort, but a hung worker cannot stall the whole suite forever.

```ts
test('times out cleanly', {
  timeout: 500,
  async setup() {
    return await createThing();
  },
  async run(thing, context) {
    await doSomethingLongRunning(thing, context.signal);
  },
  async teardown(thing) {
    await disposeThing(thing);
  },
});
```

## Coverage

Enable with `--coverage` and at least one **`--coverage-include=<glob>`** (repeatable). Optional **`--coverage-exclude=<glob>`** removes paths from the eligible set. **`--coverage-report=lcov`** writes `coverage/lcov.info`. **`--coverage-min=<0–100>`** fails the run if overall line coverage is below that value (and every eligible file was measured).

Point includes at **authored sources** you care about—for example `src/**/*.ts` and `bin/**/*.ts` in a TypeScript package. V8 still executes the compiled JavaScript under whatever `compilerOptions.outDir` your project uses (`dist/`, `build/`, `lib/`, etc.); source maps map coverage back to those `.ts` paths. Listing only `**/*.js` under `outDir` is valid but often **noisier** than matching source trees.

Pure type-only modules (e.g. `export type` / `import type` only) compile to empty or `export {}` stubs and usually show up as **eligible but unmeasured**—exclude them with `--coverage-exclude` if you want a clean “100% measured” summary.

**Consumers in this monorepo:** the `logd`, `logd-console-output`, and `logd-opentelemetry` packages under `rainbow-labs/lib/` run `section` with these flags from their `npm test` scripts (see each package README).

The default **terminal** summary shows bars comparable to the test progress bar (**80 characters** wide): one for **how many eligible files were measured** (never-loaded files count as 0%), and one for **line hit rate inside measured files only**—so you are not shown “100%” overall while large parts of the include set were never loaded. **TTY** output wraps unmeasured paths as a **comma-separated** block (**80** columns max per line, about **four** lines then `… (+N more)`). **`--agent-output`**, **`--json-summary`**, or **non-TTY** stdout keeps **one path per line** (full list) for logs and scripting. Full per-file detail remains in **LCOV** for tooling.

## Exports

- `AgentPlainReporter` — optional plain-text reporter (see `--agent-output`).
- `test(name, run)`
- `test(name, { setup, run, teardown, timeout, mode })`
- `serial(name, run | options)`
- `suite(name, ...entries)`
- `defineTests(...entries)`
- `SpecReporter`
- `TestRunner`

## Migration

See [MIGRATION_FOR_AGENTS.md](./MIGRATION_FOR_AGENTS.md) for the migration guide from the old `section(...)` API to the new atomic model. That document is written mainly for AI agents performing repo-wide rewrites.