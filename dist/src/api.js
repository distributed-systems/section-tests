export const DEFAULT_TEST_TIMEOUT = 2000;
export function test(name, runOrOptions) {
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
export function suite(name, ...entries) {
    if (typeof name !== 'string' || !name.length) {
        throw new Error('A suite name is required.');
    }
    return {
        kind: 'suite',
        name,
        entries,
    };
}
export function serial(name, runOrOptions) {
    const definition = test(name, runOrOptions);
    return {
        ...definition,
        mode: 'serial',
    };
}
export function defineTests(...entries) {
    return entries;
}
//# sourceMappingURL=api.js.map