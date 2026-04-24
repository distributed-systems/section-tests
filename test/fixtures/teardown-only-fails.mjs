/** Single test: `run` succeeds, `teardown` throws — suite must fail with teardown failure, not pass. */
import { test } from '../../dist/index.js';

export default [
    test('run ok teardown throws', {
        async run() {},
        async teardown() {
            throw new Error('TEARDOWN_ONLY_THROW');
        },
    }),
];
