/**
 * Direct worker stdout/stderr writes must be converted into `test-log` events so they do not
 * corrupt the interactive live board / agent blocks.
 */
import { test } from '../../dist/index.js';

export default [
    test('captures direct console and stderr writes', async () => {
        console.log('DIRECT_STDOUT_MARKER');
        process.stderr.write('DIRECT_STDERR_MARKER\n');
    }),
];
