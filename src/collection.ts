import { pathToFileURL } from 'node:url';
import {
    CollectedTest,
    SuiteDefinition,
    TestDefinition,
    TestEntry,
    TestPlan,
} from './runtime-types.js';

interface CollectTestPlanOptions {
    defaultTimeoutMs: number;
}

function normalizeEntries(value: unknown): TestEntry[] {
    if (Array.isArray(value)) return value as TestEntry[];
    if (isSuiteDefinition(value) || isTestDefinition(value)) return [value];
    return [];
}

function isSuiteDefinition(value: unknown): value is SuiteDefinition {
    return !!value && typeof value === 'object' && (value as SuiteDefinition).kind === 'suite';
}

function isTestDefinition(value: unknown): value is TestDefinition {
    return !!value && typeof value === 'object' && (value as TestDefinition).kind === 'test';
}

function loadModuleEntries(moduleValue: Record<string, unknown>): TestEntry[] {
    const candidates = [
        moduleValue.default,
        moduleValue.tests,
        moduleValue.test,
    ];

    for (const candidate of candidates) {
        const entries = normalizeEntries(candidate);
        if (entries.length) return entries;
    }

    return [];
}

function flattenEntries(
    file: string,
    entries: TestEntry[],
    defaultTimeoutMs: number,
    suitePath: string[] = [],
    entryPath: number[] = [],
    tests: CollectedTest[] = [],
): CollectedTest[] {
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

export async function collectEntriesFromFile(file: string): Promise<TestEntry[]> {
    const moduleValue = await import(pathToFileURL(file).href);
    const entries = loadModuleEntries(moduleValue as Record<string, unknown>);

    if (!entries.length) {
        throw new Error(`No tests exported from ${file}. Export a test, suite, or an array as default.`);
    }

    return entries;
}

export async function collectTestPlan(files: string[], options: CollectTestPlanOptions): Promise<TestPlan> {
    const tests: CollectedTest[] = [];

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

export async function resolveCollectedTest(test: CollectedTest): Promise<TestDefinition> {
    const entries = await collectEntriesFromFile(test.file);
    let current: TestEntry | undefined = entries;

    for (const index of test.entryPath) {
        if (!Array.isArray(current)) {
            if (isSuiteDefinition(current)) current = current.entries;
            else break;
        }

        current = (current as TestEntry[])[index];
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
