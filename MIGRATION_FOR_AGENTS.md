# section-tests Migration For Agents

This document explains how to migrate old `section-tests` suites that use the legacy `section(...)` API into the new atomic `test(...)` model.

The target reader is an AI agent doing large-scale migration work. The guidance is explicit and pattern-based so it can be applied consistently across many files.

## Core Rule

Share code, not runtime state.

The new model assumes:
- each test is independent
- each test may optionally define `setup -> run -> teardown`
- setup returns data for one test execution only
- reusable setup belongs in helper functions, not in shared live fixture instances
- tests are parallel by default
- timeouts abort the test context and may still attempt bounded teardown before the worker is terminated

## Old To New Mapping

### `section('name', callback)`

Old:

```ts
section('users', (section) => {
  section.test('create', async () => {
    // ...
  });
});
```

New:

```ts
import { defineTests, suite, test } from 'section-tests';

export default defineTests(
  suite(
    'users',
    test('create', async () => {
      // ...
    }),
  ),
);
```

Notes:
- nested `section(...)` trees become nested `suite(...)` trees
- suite nesting is for organization and reporting only
- do not rely on suite order for behavior

### `section.test('name', fn)`

Old:

```ts
section.test('create user', async () => {
  const result = await createUser();
  assert.ok(result);
});
```

New:

```ts
test('create user', async () => {
  const result = await createUser();
  assert.ok(result);
});
```

If there is no setup or teardown, use the short form.

### `section.setup(...)` and `section.destroy(...)`

Old:

```ts
section.setup(async () => {
  await connectDb();
});

section.destroy(async () => {
  await closeDb();
});
```

New:

```ts
async function createDb() {
  const db = await connectDb();
  return db;
}

async function disposeDb(db) {
  await closeDb(db);
}

test('example', {
  async setup() {
    return await createDb();
  },
  async run(db) {
    // ...
  },
  async teardown(db) {
    await disposeDb(db);
  },
});
```

Important:
- do not convert one global setup into one global shared runtime object unless the code is truly serial-only
- instead, extract reusable helper functions and call them per test
- write setup/run/teardown helpers so they can stop cooperatively when the provided `AbortSignal` is aborted

## Common Migration Patterns

### 1. Shared Setup Code

If many old tests use the same setup flow, extract a helper:

```ts
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

Use that helper instead of inventing runtime-sharing semantics.

### 2. File-Order Coupling

Old:
- `000.setup.js` registers reporter or setup
- `999.main.js` assumes earlier files already ran

New:
- each file must export self-contained tests or suites
- no file may depend on another file having executed first
- move shared logic into imported helpers

### 3. Nested Sequential Flows

Old:

```ts
section('workflow', (section) => {
  section.test('step 1', async () => { ... });
  section.test('step 2', async () => { ... });
  section.test('step 3', async () => { ... });
});
```

If later steps depend on earlier steps, do not keep them as separate parallel tests.

Rewrite as either:
- independent tests with their own setup, or
- one explicit scenario test

Example:

```ts
test('workflow scenario', {
  async setup() {
    return await createWorkflowState();
  },
  async run(state) {
    await step1(state);
    await step2(state);
    await step3(state);
  },
  async teardown(state) {
    await disposeWorkflowState(state);
  },
});
```

### 4. Inline Logging

Old:

```ts
section.info('created user');
section.warn('slow path');
```

New:

```ts
test('example', async (t) => {
  t.info('created user');
  t.warn('slow path');
});
```

### 5. Timeout-Aware Helpers

Helpers used from `setup`, `run`, or `teardown` should be cancellation-aware whenever possible.

Prefer:

```ts
test('example', {
  async run(_setup, context) {
    await doWork({ signal: context.signal });
  },
});
```

Avoid migration patterns that create long-running work with no way to stop, unless the test is truly exercising timeout behavior itself.

Or with setup:

```ts
test('example', {
  async setup(t) {
    t.info('preparing');
    return await createThing();
  },
  async run(thing, t) {
    t.success('running');
  },
});
```

## When To Keep Something Serial

Prefer parallel tests. Only keep a test serial if it truly touches a global or exclusive resource that cannot be isolated.

Use `serial(...)` for cases like:
- one real port that cannot be changed
- one external account with rate limits or global state
- one process-wide singleton that cannot be refactored yet

Do not mark tests serial just because old code used a shared setup tree.

## Migration Checklist

For every old file:
1. Remove implicit file-order assumptions.
2. Convert `section(...)` nesting to `suite(...)` only when it helps naming/reporting.
3. Convert `section.test(...)` to `test(...)`.
4. Replace `section.setup(...)` / `section.destroy(...)` with reusable helper functions plus per-test lifecycle hooks.
5. Ensure every test can run alone.
6. Use `serial(...)` only for true exclusivity.
7. Make helpers cancellation-aware if they may run for a long time.
8. Preserve test names where possible so reporter output remains recognizable.

## Preferred Output Shape

A migrated file should usually look like this:

```ts
import { defineTests, suite, test } from 'section-tests';

async function createThing() {
  // ...
}

async function disposeThing(thing) {
  // ...
}

export default defineTests(
  suite(
    'feature area',
    test('does one thing', {
      async setup() {
        return await createThing();
      },
      async run(thing) {
        // ...
      },
      async teardown(thing) {
        await disposeThing(thing);
      },
    }),
  ),
);
```

That shape is easy for agents to generate, easy for humans to review, and parallel-safe by default.
