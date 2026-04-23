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

The CLI supports:
- `--jobs=<n>` to control worker parallelism
- `--timeout=<ms>` to change the runner default timeout for tests that do not specify one
- `--timeout-grace=<ms>` to control how long a timed-out worker may linger for cleanup before forced termination
- `--json-summary` or `SECTION_TESTS_JSON_SUMMARY=1` for one machine-readable summary line on stderr

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

## Exports

- `test(name, run)`
- `test(name, { setup, run, teardown, timeout, mode })`
- `serial(name, run | options)`
- `suite(name, ...entries)`
- `defineTests(...entries)`
- `SpecReporter`
- `TestRunner`

## Migration

See [MIGRATION_FOR_AGENTS.md](./MIGRATION_FOR_AGENTS.md) for the migration guide from the old `section(...)` API to the new atomic model. That document is written mainly for AI agents performing repo-wide rewrites.