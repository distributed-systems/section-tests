/**
 * Used by CLI integration test: exercises the real `logd` package (not `context.info`),
 * so worker `registerLogSink` must turn module logs into `test-log` events when `--test-logs` or `--agent-output` is on.
 */
import logd from 'logd';
import { test } from '../../dist/index.js';

const log = logd.module('section-tests-fixture');

export default [
    test('emits logd during run', async () => {
        log.info('LOGD_DIRECT_INTEGRATION_MARKER');
    }),
];
