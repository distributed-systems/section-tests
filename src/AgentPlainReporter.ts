import {
    CollectedTest,
    Reporter,
    TestEvent,
    TestPlan,
    TestRunSummary,
} from './runtime-types.js';

function oneLine(text: string): string {
    return text.replace(/\r\n/g, '\n').replace(/\n/g, ' \\n ');
}

function suiteHeading(suitePath: string[]): string {
    return suitePath.length ? suitePath.join(' > ') : '(root)';
}

function describeTest(test: Pick<CollectedTest, 'name' | 'suitePath'>): string {
    const head = suiteHeading(test.suitePath);
    return head ? `${head} > ${test.name}` : test.name;
}

function sortTestsForPlan(tests: CollectedTest[]): CollectedTest[] {
    return [...tests].sort((a, b) => {
        const fa = a.file.localeCompare(b.file);
        if (fa !== 0) return fa;
        const sa = a.suitePath.join('\0').localeCompare(b.suitePath.join('\0'));
        if (sa !== 0) return sa;
        return a.name.localeCompare(b.name);
    });
}

/**
 * Linear, low-noise output for scripts and AI agents: one event per line, plan printed up front,
 * no TTY / log-update board. Does not replace {@link SpecReporter}; enable via `--agent-output` or
 * `SECTION_TESTS_AGENT_OUTPUT=1`.
 */
export default class AgentPlainReporter implements Reporter {
    constructor(_options?: { showTestLogs?: boolean }) {
        // Options reserved for API parity with `SpecReporter`; agent mode always prints `test-log` lines.
    }

    onPlan(plan: TestPlan): void {
        const lines: string[] = [];
        lines.push('');
        lines.push('================================================================================');
        lines.push('section-tests — agent output (plain chronological log)');
        lines.push('================================================================================');
        lines.push(`cwd: ${process.cwd()}`);
        lines.push(`plan.files (${plan.files.length}): ${plan.files.join(', ')}`);
        lines.push(`total.tests: ${plan.tests.length}`);
        lines.push('');

        const byFile = new Map<string, CollectedTest[]>();
        for (const t of sortTestsForPlan(plan.tests)) {
            const list = byFile.get(t.file) ?? [];
            list.push(t);
            byFile.set(t.file, list);
        }

        lines.push('--------------------------------------------------------------------------------');
        lines.push('PLAN (grouped by file, then suite path)');
        lines.push('--------------------------------------------------------------------------------');

        for (const [file, tests] of [...byFile.entries()].sort(([a], [b]) => a.localeCompare(b))) {
            lines.push('');
            lines.push(`file: ${file}`);
            let lastSuite = '\0';
            for (const t of tests) {
                const suiteKey = t.suitePath.join('\0');
                if (suiteKey !== lastSuite) {
                    lastSuite = suiteKey;
                    lines.push(`  suite: ${suiteHeading(t.suitePath)}`);
                }
                const mode = t.mode === 'serial' ? 'serial' : 'parallel';
                lines.push(
                    `    • ${JSON.stringify(t.name)} id=${t.id} mode=${mode} timeout_ms=${t.timeout}`,
                );
            }
        }

        lines.push('');
        lines.push('--------------------------------------------------------------------------------');
        lines.push('RUN (chronological; one line per event)');
        lines.push('--------------------------------------------------------------------------------');
        lines.push('');
        console.log(lines.join('\n'));
    }

    onEvent(event: TestEvent): void {
        const base = describeTest({
            name: event.testName,
            suitePath: event.suitePath,
        });
        const slot = event.workerSlot !== undefined ? String(event.workerSlot) : '-';
        const head = `[section-tests:run] ${base}`;

        switch (event.type) {
            case 'test-started':
                console.log(
                    `${head} | worker=${event.workerId} slot=${slot} | START | mode=${event.mode}`,
                );
                break;
            case 'phase-started':
            case 'phase-finished':
                console.log(`${head} | worker=${event.workerId} slot=${slot} | ${event.type.toUpperCase()} | phase=${event.phase}`);
                break;
            case 'test-log':
                console.log(
                    `${head} | worker=${event.workerId} slot=${slot} | LOG | level=${event.level} | ${oneLine(event.message)}`,
                );
                break;
            case 'test-timeout':
                console.log(
                    `${head} | worker=${event.workerId} slot=${slot} | TIMEOUT | phase=${event.timeout.phase} timeout_ms=${event.timeout.timeoutMs}`,
                );
                break;
            case 'worker-terminated':
                console.log(
                    `${head} | worker=${event.workerId} slot=${slot} | WORKER_TERMINATED | forced=${String(event.workerTermination.forced)} reason=${event.workerTermination.reason} grace_ms=${event.workerTermination.graceMs}`,
                );
                break;
            case 'test-finished': {
                const parts = [
                    `status=${event.status}`,
                    `duration_ms=${event.durationMs}`,
                    `prepare_ms=${event.prepareDurationMs}`,
                    `teardown=${event.teardownStatus}`,
                ];
                if (event.failurePhase) parts.push(`failure_phase=${event.failurePhase}`);
                if (event.timeout) parts.push(`timeout_phase=${event.timeout.phase}`);
                if (event.failure) {
                    parts.push(`error=${JSON.stringify(event.failure.name)}: ${oneLine(event.failure.message)}`);
                    if (event.failure.stack) parts.push(`stack=${oneLine(event.failure.stack)}`);
                }
                if (event.workerTermination) {
                    parts.push(
                        `worker_termination=${event.workerTermination.reason} grace_ms=${event.workerTermination.graceMs}`,
                    );
                }
                console.log(`${head} | worker=${event.workerId} slot=${slot} | FINISH | ${parts.join(' | ')}`);
                break;
            }
            default:
                break;
        }
    }

    onSummary(summary: TestRunSummary): void {
        const lines: string[] = [];
        lines.push('');
        lines.push('================================================================================');
        lines.push('SUMMARY');
        lines.push('================================================================================');
        lines.push(
            `passed: ${summary.ok}  failed: ${summary.failed}  total: ${summary.total}  duration_ms=${summary.durationMs}  pass=${summary.pass}`,
        );
        const failed = summary.records.filter((r) => r.status !== 'passed');
        if (failed.length) {
            lines.push('');
            lines.push('--- failed tests ---');
            for (const r of failed) {
                const label = describeTest(r.test);
                lines.push(`  • ${label}`);
                if (r.failure) {
                    lines.push(`    ${r.failure.name}: ${oneLine(r.failure.message)}`);
                }
            }
        }
        lines.push('');
        console.log(lines.join('\n'));
    }

    flush(): void {
        // No buffered TTY state; summary already printed end-state in onSummary.
    }
}
