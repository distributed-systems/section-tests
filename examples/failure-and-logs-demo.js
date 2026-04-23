/**
 * Demo: end-of-run failure output vs context `test-log` lines.
 *
 * From the `section-tests` package root, after `npm run build`:
 *
 *   # Default: failures are reported (message + stack); buffered context logs are not.
 *   node dist/bin/run.js --jobs=1 examples/failure-and-logs-demo.js
 *
 *   # Also print the "Test log (from context)" block at the end.
 *   node dist/bin/run.js --test-logs --jobs=1 examples/failure-and-logs-demo.js
 *
 * Env: `SECTION_TESTS_TEST_LOGS=1` is equivalent to `--test-logs`.
 */
import assert from 'node:assert/strict';
import { defineTests, test } from '../dist/index.js';

export default defineTests(
    test('demo: failure + context logs (use --test-logs for the end-of-run log block in TTY)', async (context) => {
        context.info('diagnostic: about to assert');
        context.warn('intentional failure for demo (omit this file from CI globs if you do not want a red build)');
        assert.equal(1, 2, 'expected 1 to equal 2 (demo)');
    }),
);
