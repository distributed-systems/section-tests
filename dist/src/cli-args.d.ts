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
/**
 * Shared argv parsing for `bin/run.ts` and `bin/run-npm.ts`.
 */
export declare function parseRunnerArgv(argv: string[]): ParsedRunnerArgv;
export declare function validateCoverageArgv(parsed: ParsedRunnerArgv): void;
//# sourceMappingURL=cli-args.d.ts.map