#!/usr/bin/env node
import TestRunner from '../src/TestRunner.js';
const argv = process.argv.slice(2);
const jsonSummary = argv.includes('--json-summary') || process.env.SECTION_TESTS_JSON_SUMMARY === '1';
const showTestLogs = argv.includes('--test-logs') || process.env.SECTION_TESTS_TEST_LOGS === '1';
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
const patterns = argv.filter((value, index) => {
    if (!value)
        return false;
    if (value === '--json-summary')
        return false;
    if (value === '--test-logs')
        return false;
    if (value.startsWith('--jobs='))
        return false;
    if (value === '--jobs')
        return false;
    if (jobsIndex >= 0 && index === jobsIndex + 1)
        return false;
    if (value.startsWith('--timeout='))
        return false;
    if (value === '--timeout')
        return false;
    if (timeoutIndex >= 0 && index === timeoutIndex + 1)
        return false;
    if (value.startsWith('--timeout-grace='))
        return false;
    if (value === '--timeout-grace')
        return false;
    if (timeoutGraceIndex >= 0 && index === timeoutGraceIndex + 1)
        return false;
    return value[0] !== '-';
});
new TestRunner({
    patterns,
    jsonSummary,
    showTestLogs,
    jobs,
    defaultTimeoutMs: timeout,
    timeoutGraceMs: timeoutGrace,
}).execute();
//# sourceMappingURL=run-npm.js.map