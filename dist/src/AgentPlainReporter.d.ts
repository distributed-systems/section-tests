import { Reporter, TestEvent, TestPlan, TestRunSummary } from './runtime-types.js';
/**
 * Human- and agent-friendly plain output: colorful plan up front, then per-test detail printed
 * when each test finishes (phases and `test-log` grouped under that test). No box-drawing rules.
 * Enable with `--agent-output` or `SECTION_TESTS_AGENT_OUTPUT=1`.
 */
export default class AgentPlainReporter implements Reporter {
    private readonly pending;
    constructor(_options?: {
        showTestLogs?: boolean;
    });
    private ensurePending;
    private push;
    onPlan(plan: TestPlan): void;
    onEvent(event: TestEvent): void;
    private printCompletedBlock;
    onSummary(summary: TestRunSummary): void;
    flush(): void;
}
//# sourceMappingURL=AgentPlainReporter.d.ts.map