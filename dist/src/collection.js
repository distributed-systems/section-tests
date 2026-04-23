import { pathToFileURL } from 'node:url';
function normalizeEntries(value) {
    if (Array.isArray(value))
        return value;
    if (isSuiteDefinition(value) || isTestDefinition(value))
        return [value];
    return [];
}
function isSuiteDefinition(value) {
    return !!value && typeof value === 'object' && value.kind === 'suite';
}
function isTestDefinition(value) {
    return !!value && typeof value === 'object' && value.kind === 'test';
}
function loadModuleEntries(moduleValue) {
    const candidates = [
        moduleValue.default,
        moduleValue.tests,
        moduleValue.test,
    ];
    for (const candidate of candidates) {
        const entries = normalizeEntries(candidate);
        if (entries.length)
            return entries;
    }
    return [];
}
function flattenEntries(file, entries, defaultTimeoutMs, suitePath = [], entryPath = [], tests = []) {
    entries.forEach((entry, index) => {
        const currentPath = [...entryPath, index];
        if (Array.isArray(entry)) {
            flattenEntries(file, entry, defaultTimeoutMs, suitePath, currentPath, tests);
            return;
        }
        if (isSuiteDefinition(entry)) {
            flattenEntries(file, entry.entries, defaultTimeoutMs, [...suitePath, entry.name], currentPath, tests);
            return;
        }
        if (!isTestDefinition(entry)) {
            throw new Error(`Invalid test entry in ${file} at path ${currentPath.join('.')}.`);
        }
        tests.push({
            id: `${file}::${currentPath.join('.')}`,
            file,
            name: entry.name,
            suitePath,
            mode: entry.mode,
            timeout: entry.timeout ?? defaultTimeoutMs,
            entryPath: currentPath,
            source: {
                hasSetup: typeof entry.setup === 'function',
                hasTeardown: typeof entry.teardown === 'function',
            },
        });
    });
    return tests;
}
export async function collectEntriesFromFile(file) {
    const moduleValue = await import(pathToFileURL(file).href);
    const entries = loadModuleEntries(moduleValue);
    if (!entries.length) {
        throw new Error(`No tests exported from ${file}. Export a test, suite, or an array as default.`);
    }
    return entries;
}
export async function collectTestPlan(files, options) {
    const tests = [];
    for (const file of files) {
        const entries = await collectEntriesFromFile(file);
        flattenEntries(file, entries, options.defaultTimeoutMs, [], [], tests);
    }
    if (!tests.length) {
        throw new Error('No tests collected.');
    }
    return {
        files,
        tests,
    };
}
export async function resolveCollectedTest(test) {
    const entries = await collectEntriesFromFile(test.file);
    return resolveCollectedTestFromEntries(entries, test);
}
export function resolveCollectedTestFromEntries(entries, test) {
    let current = entries;
    for (const index of test.entryPath) {
        if (!Array.isArray(current)) {
            if (isSuiteDefinition(current))
                current = current.entries;
            else
                break;
        }
        current = current[index];
    }
    if (!current) {
        throw new Error(`Could not resolve test "${test.name}" from ${test.file}.`);
    }
    if (Array.isArray(current)) {
        throw new Error(`Entry path for "${test.name}" in ${test.file} does not resolve to a test.`);
    }
    if (isSuiteDefinition(current)) {
        throw new Error(`Entry path for "${test.name}" in ${test.file} resolved to a suite, not a test.`);
    }
    if (!isTestDefinition(current)) {
        throw new Error(`Resolved invalid test entry for "${test.name}" in ${test.file}.`);
    }
    return current;
}
//# sourceMappingURL=collection.js.map