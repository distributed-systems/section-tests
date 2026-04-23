import { Reporter, TestEvent, TestPlan, TestRunSummary } from './runtime-types.js';
type Renderer = ((message: string) => void) & {
    done: () => void;
    clear: () => void;
};
interface SpecReporterOptions {
    interactive?: boolean;
    output?: NodeJS.WriteStream;
    renderIntervalMs?: number;
    compactThreshold?: number;
    maxRunningTests?: number;
    createRenderer?: (stream: NodeJS.WriteStream) => Renderer;
}
export default class SpecReporter implements Reporter {
    private plan?;
    private records;
    private summary?;
    private suiteProgress;
    private suiteOrder;
    private startedOrder;
    private runningOrder;
    private readonly output;
    private readonly interactive;
    private readonly renderer;
    private readonly renderIntervalMs;
    private readonly compactThreshold;
    private readonly maxRunningTests;
    private mode;
    private renderTimer;
    constructor({ interactive, output, renderIntervalMs, compactThreshold, maxRunningTests, createRenderer, }?: SpecReporterOptions);
    onPlan(plan: TestPlan): void;
    onEvent(event: TestEvent): void;
    onSummary(summary: TestRunSummary): void;
    flush(): void;
    private scheduleRender;
    private renderNow;
    private clearPendingRender;
    private renderInteractiveBoard;
    private renderDetailedLines;
    private renderCompactLines;
    private displayFinishedRecord;
    private displayFailureDetails;
    private buildStatsLine;
    private displayWorkerTerminationEvent;
    private formatRecordLine;
    private formatSuiteLine;
    private getSuiteInfo;
    private getOrCreateSuiteProgress;
    private getDuplicateSuiteLabels;
    private formatDuration;
    private formatStatDuration;
    private pad;
}
export {};
//# sourceMappingURL=SpecReporter.d.ts.map