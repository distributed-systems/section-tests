import { Reporter, TestEvent, TestPlan, TestRunSummary } from './runtime-types.js';
type Renderer = ((message: string) => void) & {
    done: () => void;
    clear: () => void;
};
interface SpecReporterOptions {
    interactive?: boolean;
    output?: NodeJS.WriteStream;
    renderIntervalMs?: number;
    workerSlots?: number;
    createRenderer?: (stream: NodeJS.WriteStream) => Renderer;
}
export default class SpecReporter implements Reporter {
    private plan?;
    private records;
    private summary?;
    private slotStates;
    private workerIdToSlot;
    private readonly output;
    private readonly interactive;
    private readonly renderer;
    private readonly renderIntervalMs;
    private configuredWorkerSlots;
    private renderTimer;
    constructor({ interactive, output, renderIntervalMs, workerSlots, createRenderer, }?: SpecReporterOptions);
    setWorkerSlots(workerSlots: number): void;
    onPlan(plan: TestPlan): void;
    onEvent(event: TestEvent): void;
    onSummary(summary: TestRunSummary): void;
    flush(): void;
    private scheduleRender;
    private renderNow;
    private clearPendingRender;
    private renderInteractiveBoard;
    private renderSlotLines;
    private displayFinishedRecord;
    private displayFailureDetails;
    private buildStatsLine;
    private displayWorkerTerminationEvent;
    private formatSlotLine;
    private formatRecordLine;
    private describeTest;
    private resolveSlot;
    private ensureSlot;
    private formatDuration;
    private formatStatDuration;
    private pad;
}
export {};
//# sourceMappingURL=SpecReporter.d.ts.map