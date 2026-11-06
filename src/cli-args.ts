export type CoverageReportKind = 'lcov' | 'none';

export interface ParsedRunnerArgv {
    patterns: string[];
    jsonSummary: boolean;
    showTestLogs: boolean;
    agentOutput: boolean;
    jobs?: number;
    timeout?: number;
    timeoutGrace?: number;
    coverage: boolean;
    coverageInclude: string[];
    coverageExclude: string[];
    coverageReport: CoverageReportKind;
    coverageMin?: number;
}

function flagValue(argv: string[], name: string): string | undefined {
    const eq = argv.find((v) => v === `--${name}` || v.startsWith(`--${name}=`));
    if (!eq) return undefined;
    if (eq.includes('=')) return eq.split('=').slice(1).join('=');
    const i = argv.indexOf(eq);
    return argv[i + 1];
}

function allFlagValues(argv: string[], name: string): string[] {
    const out: string[] = [];
    const prefix = `--${name}=`;
    for (let i = 0; i < argv.length; i++) {
        const v = argv[i]!;
        if (v.startsWith(prefix)) {
            const val = v.slice(prefix.length).trim();
            if (val) out.push(val);
        } else if (v === `--${name}`) {
            const next = argv[i + 1];
            if (next && !next.startsWith('-')) {
                const val = next.trim();
                if (val) out.push(val);
                i++;
            }
        }
    }
    return out;
}

/**
 * Shared argv parsing for `bin/run.ts` and `bin/run-npm.ts`.
 */
export function parseRunnerArgv(argv: string[]): ParsedRunnerArgv {
    const jsonSummary = argv.includes('--json-summary') || process.env.SECTION_TESTS_JSON_SUMMARY === '1';
    const showTestLogs = argv.includes('--test-logs') || process.env.SECTION_TESTS_TEST_LOGS === '1';
    const agentOutput = argv.includes('--agent-output') || process.env.SECTION_TESTS_AGENT_OUTPUT === '1';

    const jobsFlag = argv.find((value) => value.startsWith('--jobs='));
    const jobsIndex = argv.findIndex((value) => value === '--jobs');
    const jobsValue = jobsFlag
        ? jobsFlag.split('=')[1]
        : jobsIndex >= 0
            ? argv[jobsIndex + 1]
            : undefined;
    const jobs = jobsValue ? Number.parseInt(jobsValue, 10) : undefined;

    const timeoutFlag = argv.find((value) => value.startsWith('--timeout='));
    const timeoutIndex = argv.findIndex((value) => value === '--timeout');
    const timeoutValue = timeoutFlag
        ? timeoutFlag.split('=')[1]
        : timeoutIndex >= 0
            ? argv[timeoutIndex + 1]
            : undefined;
    const timeout = timeoutValue ? Number.parseInt(timeoutValue, 10) : undefined;

    const timeoutGraceFlag = argv.find((value) => value.startsWith('--timeout-grace='));
    const timeoutGraceIndex = argv.findIndex((value) => value === '--timeout-grace');
    const timeoutGraceValue = timeoutGraceFlag
        ? timeoutGraceFlag.split('=')[1]
        : timeoutGraceIndex >= 0
            ? argv[timeoutGraceIndex + 1]
            : undefined;
    const timeoutGrace = timeoutGraceValue ? Number.parseInt(timeoutGraceValue, 10) : undefined;

    const coverage = argv.includes('--coverage');
    const coverageInclude = allFlagValues(argv, 'coverage-include');
    const coverageExclude = allFlagValues(argv, 'coverage-exclude');
    const reportRaw = flagValue(argv, 'coverage-report');
    let coverageReport: CoverageReportKind = 'none';
    if (reportRaw === 'lcov') coverageReport = 'lcov';
    else if (reportRaw !== undefined && reportRaw !== '') {
        throw new Error(`Unsupported --coverage-report=${reportRaw}. Only 'lcov' is supported.`);
    }

    const minRaw = flagValue(argv, 'coverage-min');
    const coverageMin = minRaw !== undefined && minRaw !== '' ? Number.parseInt(minRaw, 10) : undefined;
    if (minRaw !== undefined && minRaw !== '' && (Number.isNaN(coverageMin!) || coverageMin! < 0 || coverageMin! > 100)) {
        throw new Error(`Invalid --coverage-min (expected 0–100).`);
    }

    const reserved = new Set<string>([
        '--json-summary',
        '--test-logs',
        '--agent-output',
        '--jobs',
        '--timeout',
        '--timeout-grace',
        '--coverage',
        '--coverage-include',
        '--coverage-exclude',
        '--coverage-report',
        '--coverage-min',
    ]);

    const skipNext = new Set<number>();
    for (let i = 0; i < argv.length; i++) {
        const v = argv[i];
        if (!v) continue;
        if (v === '--jobs' || v === '--timeout' || v === '--timeout-grace') {
            if (argv[i + 1] && !argv[i + 1].startsWith('-')) skipNext.add(i + 1);
            continue;
        }
        if (v === '--coverage-include' || v === '--coverage-exclude' || v === '--coverage-report' || v === '--coverage-min') {
            if (argv[i + 1] && !argv[i + 1].startsWith('-')) skipNext.add(i + 1);
        }
    }

    const patterns = argv.filter((value, index) => {
        if (!value) return false;
        if (reserved.has(value)) return false;
        if (value.startsWith('--jobs=')) return false;
        if (value.startsWith('--timeout=')) return false;
        if (value.startsWith('--timeout-grace=')) return false;
        if (value.startsWith('--coverage-include=')) return false;
        if (value.startsWith('--coverage-exclude=')) return false;
        if (value.startsWith('--coverage-report=')) return false;
        if (value.startsWith('--coverage-min=')) return false;
        if (skipNext.has(index)) return false;
        return value[0] !== '-';
    });

    return {
        patterns,
        jsonSummary,
        showTestLogs,
        agentOutput,
        jobs,
        timeout,
        timeoutGrace,
        coverage,
        coverageInclude,
        coverageExclude,
        coverageReport,
        coverageMin,
    };
}

export function validateCoverageArgv(parsed: ParsedRunnerArgv): void {
    if (!parsed.coverage) return;
    const includes = parsed.coverageInclude.filter((p) => p.trim().length > 0);
    if (!includes.length) {
        throw new Error('section-tests: --coverage requires at least one --coverage-include=<glob>.');
    }
}
