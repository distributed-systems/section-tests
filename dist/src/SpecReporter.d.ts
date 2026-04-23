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
    /** When true, show buffered `context` / test-log output after the run (and in CI). Default false. */
    showTestLogs?: boolean;
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
    private bufferedTestLogs;
    private readonly showTestLogs;
    private totalTestsPlanned;
    private testsFinished;
    constructor({ interactive, output, 
    /** Cap repaint rate for TTY. Lower = snappier; 0 = render on every event (no throttle). */
    renderIntervalMs, workerSlots, createRenderer, showTestLogs, }?: SpecReporterOptions);
    setWorkerSlots(workerSlots: number): void;
    private printRunHeader;
    onPlan(plan: TestPlan): void;
    onEvent(event: TestEvent): void;
    onSummary(summary: TestRunSummary): void;
    flush(): void;
    /**
     * Throttle interactive redraws: when many reporter events land in the same turn (e.g. parallel
     * workers), we only schedule one `setTimeout` until it fires, so the board updates in bursts, not
     * once per event — that is intentional and can look like "step" updates. The `log-update` buffer
     * also wraps the frame to `columns` and clips from the *top* if wrapped lines exceed `rows`,
     * which in a short or narrow terminal can look like a fixed viewport / missing progress line.
     */
    private scheduleRender;
    private renderNow;
    private clearPendingRender;
    private renderInteractiveBoard;
    private static readonly progressBarWidth;
    private formatProgressLine;
    private renderSlotLines;
    private displayFinishedRecord;
    private printTestLog;
    private formatTestLogLevel;
    private displayBufferedTestLogs;
    private displayFailureDetails;
    private displayEndSummary;
    /** Wall-clock duration in short form, e.g. 12.17s or 125 ms. */
    private formatDurationClock;
    private displayWorkerTerminationEvent;
    /** Styled leading glyph: setup ↑ dim, teardown ↓ dim, run / not yet phased ▸ cyan. */
    private inProgressGlyph;
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