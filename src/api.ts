import {
    SuiteDefinition,
    TestDefinition,
    TestDefinitionOptions,
    TestEntry,
    TestRunWithoutSetup,
} from './runtime-types.js';

export const DEFAULT_TEST_TIMEOUT = 2_000;

export function test(name: string, run: TestRunWithoutSetup): TestDefinition;
export function test<TSetup = unknown>(name: string, options: TestDefinitionOptions<TSetup>): TestDefinition<TSetup>;
export function test<TSetup = unknown>(
    name: string,
    runOrOptions: TestRunWithoutSetup | TestDefinitionOptions<TSetup>,
): TestDefinition<TSetup> {
    if (typeof name !== 'string' || !name.length) {
        throw new Error('A test name is required.');
    }

    if (typeof runOrOptions === 'function') {
        return {
            kind: 'test',
            name,
            mode: 'parallel',
            run: runOrOptions,
        };
    }

    if (!runOrOptions || typeof runOrOptions !== 'object' || typeof runOrOptions.run !== 'function') {
        throw new Error('test(name, options) requires a run function.');
    }

    return {
        kind: 'test',
        name,
        mode: runOrOptions.mode || 'parallel',
        timeout: runOrOptions.timeout,
        setup: runOrOptions.setup,
        run: runOrOptions.run,
        teardown: runOrOptions.teardown,
    };
}

export function suite(name: string, ...entries: TestEntry[]): SuiteDefinition {
    if (typeof name !== 'string' || !name.length) {
        throw new Error('A suite name is required.');
    }

    return {
        kind: 'suite',
        name,
        entries,
    };
}

export function serial(name: string, run: TestRunWithoutSetup): TestDefinition;
export function serial<TSetup = unknown>(name: string, options: TestDefinitionOptions<TSetup>): TestDefinition<TSetup>;
export function serial<TSetup = unknown>(
    name: string,
    runOrOptions: TestRunWithoutSetup | TestDefinitionOptions<TSetup>,
): TestDefinition<TSetup> {
    const definition = test(name, runOrOptions as any);
    return {
        ...definition,
        mode: 'serial',
    } as TestDefinition<TSetup>;
}

export function defineTests(...entries: TestEntry[]): TestEntry[] {
    return entries;
}
