/** `context.error` is a log line, not an assertion failure — the test must still pass. */
import { test } from '../../dist/index.js';

export default [
    test('logs error without failing', {
        async run(context) {
            context.error('NOT_A_FAILURE_JUST_A_LOG');
        },
    }),
];
