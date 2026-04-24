import { Reporter, TestEvent, TestPlan, TestRunSummary } from './runtime-types.js';
/**
 * Linear, low-noise output for scripts and AI agents: one event per line, plan printed up front,
 * no TTY / log-update board. Does not replace {@link SpecReporter}; enable via `--agent-output` or
 * `SECTION_TESTS_AGENT_OUTPUT=1`.
 */
export default class AgentPlainReporter implements Reporter {
    constructor(_options?: {
        showTestLogs?: boolean;
    });
    onPlan(plan: TestPlan): void;
    onEvent(event: TestEvent): void;
    onSummary(summary: TestRunSummary): void;
    flush(): void;
}
//# sourceMappingURL=AgentPlainReporter.d.ts.map