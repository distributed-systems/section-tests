import { Reporter, TestEvent, TestPlan, TestRunSummary } from './runtime-types.js';
export default class SpecReporter implements Reporter {
    private plan?;
    private records;
    private summary?;
    private startedTests;
    private startedOrder;
    private readonly interactive;
    private readonly logUpdate;
    onPlan(plan: TestPlan): void;
    onEvent(event: TestEvent): void;
    onSummary(summary: TestRunSummary): void;
    flush(): void;
    private renderInteractiveBoard;
    private displayFinishedRecord;
    private displayFailureDetails;
    private displayWorkerTerminationEvent;
    private formatRecordLine;
    private getCurrentPhase;
    private formatDuration;
    private pad;
}
//# sourceMappingURL=SpecReporter.d.ts.map