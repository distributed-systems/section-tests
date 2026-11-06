#!/usr/bin/env node
import { parseRunnerArgv, validateCoverageArgv } from '../src/cli-args.js';
import TestRunner from '../src/TestRunner.js';
const argv = process.argv.slice(2);
try {
    const parsed = parseRunnerArgv(argv);
    let coverage;
    if (parsed.coverage) {
        validateCoverageArgv(parsed);
        const include = parsed.coverageInclude.map((p) => p.trim()).filter(Boolean);
        const exclude = parsed.coverageExclude.map((p) => p.trim()).filter(Boolean);
        coverage = {
            include,
            exclude,
            report: parsed.coverageReport,
            min: parsed.coverageMin,
        };
    }
    else if (!parsed.jsonSummary && !parsed.agentOutput && (process.stderr.isTTY || process.stdin.isTTY)) {
        process.stderr.write('section-tests: coverage is off; pass --coverage and at least one --coverage-include=<glob> to collect V8 coverage.\n');
    }
    new TestRunner({
        patterns: parsed.patterns,
        jsonSummary: parsed.jsonSummary,
        showTestLogs: parsed.showTestLogs,
        agentOutput: parsed.agentOutput,
        jobs: parsed.jobs,
        defaultTimeoutMs: parsed.timeout,
        timeoutGraceMs: parsed.timeoutGrace,
        coverage,
    }).execute();
}
catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    process.stderr.write(`${msg}\n`);
    process.exit(1);
}
//# sourceMappingURL=run.js.map