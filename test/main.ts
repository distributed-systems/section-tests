import log from 'ee-log'; 
import section, {SpecReporter} from '../index.js';
import assert from 'assert';
import { spawnSync } from 'node:child_process';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

section.setTimeout(1000);

section.use(new SpecReporter());

const rootDirectory = fileURLToPath(new URL('../..', import.meta.url));
const sectionImportUrl = pathToFileURL(join(rootDirectory, 'dist', 'index.js')).href;
const JSON_SUMMARY_PREFIX = 'SECTION_TESTS_SUMMARY:';

async function createRunnerFixture(shouldFail: boolean): Promise<string> {
    const tempDirectory = await mkdtemp(join(tmpdir(), 'section-tests-runner-'));
    const testFilePath = join(tempDirectory, shouldFail ? 'failure.test.mjs' : 'success.test.mjs');
    await writeFile(testFilePath, `
import assert from 'node:assert/strict';
import section, { SpecReporter } from ${JSON.stringify(sectionImportUrl)};

section.use(new SpecReporter());
section('machine summary', (section) => {
    section.test('example', async () => {
        ${shouldFail ? "assert.equal(1, 2, 'failing test');" : 'assert.equal(1, 1);'}
    });
});
`, 'utf8');
    return tempDirectory;
}

section('Libraries', {timeout: 6000}, (section) => {
    section('Venue', (section) => {
        section.test('findByZip', async () => {
            //log('testing');
            section.warn('pay attention, there stuff happening ...');
            assert.equal('3', 2, 'not equal, dude!');
        });

        section.test('create', async () => {
            //log('testing');
            return new Promise((r) => {
                setTimeout(r, 600);
            });
        });

        section.test('some method without a name', async () => {
            //log('testing');
        });
    })

    section.test('create things that are cute', async () => {
            //log('testing');
            
    });

    section.test('delete shitty stuff', async () => {
        //log('testing');
        
    });

    section.test('create another', async () => {
        //log('testing');
        
    });

    section.test('bulk create the good stuff', async () => {
        //log('testing');
    });

    section('Timeout', (section) => {
        section.test('should timeout', () => {
            section.warn('pay attention, there stuff happening ...');
            section.setTimeout(300);
            return new Promise(() => {
                setTimeout(() => {}, 3000);
            });
        });
    });

    section('Venue', (section) => {
        section.test('delete all', async () => {
            //log('testing');
            
        });

        section.test('delete one', async () => {
            //log('testing');
        });
    })

    section('Event', (section) => {
        section.test('create', async () => {
            section.warn('pay attention, there stuff happening ...');
            section.info('creating things ..');
            section.info('updating things ....');
            
        });

        section.test('update', async () => {
            //log('testing');
        });

        section.test('read', async () => {
            //log('testing');
        });

        section.test('delete', async () => {
            //log('testing');
        });
    });
});

section('Integration', (section) => {
    section.test('create', async () => {
        //log('testing');
        
    });

    section.test('update', async () => {
        //log('testing');
    });

    section.test('read', async () => {
        //log('testing');
    });

    section.test('delete', async () => {
        //log('testing');
    });
});

section('Tools', (section) => {
    section.test('wait', async () => {
        await section.wait(500);
    });
});

section('Errors', (section) => {
    section.test('print out errors neatly', async () => {
        throw new Error('this is an error');
    });
});

section('Runner output', (section) => {
    section.test('keeps human output unchanged by default', async () => {
        section.setTimeout(10_000);
        const fixtureDirectory = await createRunnerFixture(false);
        const result = spawnSync(
            process.execPath,
            [join(rootDirectory, 'dist', 'bin', 'run.js'), './success.test.mjs'],
            {
                cwd: fixtureDirectory,
                encoding: 'utf8',
                env: process.env,
            },
        );

        assert.equal(result.status, 0, result.stderr || result.stdout);
        assert.match(result.stdout, /1 tests executed successfully/i);
        assert.doesNotMatch(result.stderr, /SECTION_TESTS_SUMMARY:/i);
    });

    section.test('emits machine-readable suite summary when enabled', async () => {
        section.setTimeout(10_000);
        const fixtureDirectory = await createRunnerFixture(true);
        const result = spawnSync(
            process.execPath,
            [join(rootDirectory, 'dist', 'bin', 'run.js'), '--json-summary', './failure.test.mjs'],
            {
                cwd: fixtureDirectory,
                encoding: 'utf8',
                env: process.env,
            },
        );

        assert.equal(result.status, 1, 'failing tests should still exit non-zero');
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
    });
});

section.setup('Setting things up', () => {
    section.warn('pay attention, there stuff happening ...');
    section.info('creating things ..');
    section.info('updating things ....');
});

section.destroy('Stopping services', () => {
    section.info('you should probably know :/');
    section.warn('think twice ...');
    section.error('uh, really? probably not good :)');
    section.success(`yep, that's nice!`);
});

