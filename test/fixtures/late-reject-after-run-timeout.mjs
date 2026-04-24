/**
 * Run hangs past the per-test timeout so the worker takes the timeout + quiesce path, then the
 * in-flight `run()` promise rejects after quiesce reports `stuck`. The runner must attach a
 * rejection handler so Node does not emit `UnhandledPromiseRejection`.
 */
import { test } from '../../dist/index.js';

export default [
    test('stuck run then promise rejects', {
        timeout: 100,
        async run() {
            await new Promise((resolve) => {
                setTimeout(resolve, 600);
            });
            throw new Error('POST_STUCK_REJECT');
        },
    }),
];
