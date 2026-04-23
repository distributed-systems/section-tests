import { createLogUpdate } from 'log-update';
import chalk from './lib/chalk.js';
import {
    CollectedTest,
    Reporter,
    TestEvent,
    TestExecutionRecord,
    TestPhase,
    TestPlan,
    TestRunSummary,
} from './runtime-types.js';

type Renderer = ((message: string) => void) & { done: () => void; clear: () => void };

interface SpecReporterOptions {
    interactive?: boolean;
    output?: NodeJS.WriteStream;
    renderIntervalMs?: number;
    workerSlots?: number;
    createRenderer?: (stream: NodeJS.WriteStream) => Renderer;
}

interface LiveRecord {
    test: CollectedTest;
    workerId?: string;
    workerSlot?: number;
    currentPhase?: TestPhase;
    status?: 'passed' | 'failed';
    durationMs?: number;
    prepareDurationMs?: number;
    failure?: TestExecutionRecord['failure'];
    failurePhase?: TestExecutionRecord['failurePhase'];
    timeout?: TestExecutionRecord['timeout'];
    teardownStatus?: TestExecutionRecord['teardownStatus'];
    workerTermination?: TestExecutionRecord['workerTermination'];
}

interface SlotState {
    slot: number;
    workerId?: string;
    state: 'idle' | 'busy' | 'replacing';
    currentRecord?: LiveRecord;
    lastRecord?: LiveRecord;
}

export default class SpecReporter implements Reporter {
    private plan?: TestPlan;
    private records = new Map<string, LiveRecord>();
    private summary?: TestRunSummary;
    private slotStates = new Map<number, SlotState>();
    private workerIdToSlot = new Map<string, number>();
    private readonly output: NodeJS.WriteStream;
    private readonly interactive: boolean;
    private readonly renderer: Renderer | null;
    private readonly renderIntervalMs: number;
    private configuredWorkerSlots: number;
    private renderTimer: NodeJS.Timeout | null = null;

    constructor({
        interactive,
        output = process.stdout,
        renderIntervalMs = 50,
        workerSlots = 0,
        createRenderer = (stream) => createLogUpdate(stream) as Renderer,
    }: SpecReporterOptions = {}) {
        this.output = output;
        this.interactive = interactive ?? Boolean(output.isTTY);
        this.renderer = this.interactive ? createRenderer(this.output) : null;
        this.renderIntervalMs = renderIntervalMs;
        this.configuredWorkerSlots = workerSlots;
    }

    setWorkerSlots(workerSlots: number): void {
        this.configuredWorkerSlots = Math.max(0, workerSlots);
    }

    onPlan(plan: TestPlan): void {
        this.plan = plan;
        this.summary = undefined;
        this.records.clear();
        this.slotStates.clear();
        this.workerIdToSlot.clear();

        plan.tests.forEach((test: CollectedTest) => {
            this.records.set(test.id, {
                test,
                teardownStatus: test.source.hasTeardown ? 'not-run' : 'not-needed',
            });
        });
    }

    onEvent(event: TestEvent): void {
        const record = this.records.get(event.testId);
        if (!record) return;

        record.workerId = event.workerId;
        const slot = this.resolveSlot(event.workerId, event.workerSlot);
        if (slot !== undefined) {
            record.workerSlot = slot;
        }
        const slotState = slot !== undefined ? this.ensureSlot(slot) : undefined;

        switch (event.type) {
            case 'test-started':
                if (slotState) {
                    slotState.workerId = event.workerId;
                    slotState.state = 'busy';
                    slotState.currentRecord = record;
                }
                break;
            case 'phase-started':
                record.currentPhase = event.phase;
                if (slotState) {
                    slotState.state = 'busy';
                    slotState.currentRecord = record;
                }
                break;
            case 'phase-finished':
                if (record.currentPhase === event.phase) {
                    record.currentPhase = undefined;
                }
                break;
            case 'test-timeout':
                record.timeout = event.timeout;
                break;
            case 'worker-terminated':
                record.workerTermination = event.workerTermination;
                if (slotState) {
                    slotState.workerId = event.workerId;
                    slotState.state = 'replacing';
                    slotState.currentRecord = undefined;
                    slotState.lastRecord = record;
                }
                if (!this.interactive) {
                    this.displayWorkerTerminationEvent(record);
                }
                break;
            case 'test-finished':
                record.status = event.status;
                record.durationMs = event.durationMs;
                record.prepareDurationMs = event.prepareDurationMs;
                record.failure = event.failure;
                record.failurePhase = event.failurePhase;
                record.timeout = event.timeout;
                record.teardownStatus = event.teardownStatus;
                record.workerTermination = event.workerTermination ?? record.workerTermination;
                record.currentPhase = undefined;

                if (slotState) {
                    slotState.workerId = event.workerId;
                    slotState.currentRecord = undefined;
                    slotState.lastRecord = record;
                    slotState.state = event.workerTermination || event.timeout ? 'replacing' : 'idle';
                }
                break;
        }

        if (this.interactive) {
            this.scheduleRender();
        } else if (event.type === 'test-finished') {
            this.displayFinishedRecord(record);
        }
    }

    onSummary(summary: TestRunSummary): void {
        this.summary = summary;

        summary.records.forEach((finalRecord) => {
            const liveRecord = this.records.get(finalRecord.test.id);
            if (!liveRecord) return;
            liveRecord.status = finalRecord.status;
            liveRecord.durationMs = finalRecord.durationMs;
            liveRecord.prepareDurationMs = finalRecord.prepareDurationMs;
            liveRecord.failure = finalRecord.failure;
            liveRecord.failurePhase = finalRecord.failurePhase;
            liveRecord.timeout = finalRecord.timeout;
            liveRecord.teardownStatus = finalRecord.teardownStatus;
            liveRecord.workerTermination = finalRecord.workerTermination;
            liveRecord.currentPhase = undefined;

            const slot = liveRecord.workerSlot;
            if (!slot) return;

            const slotState = this.ensureSlot(slot);
            slotState.lastRecord = liveRecord;
            if (slotState.state !== 'busy') {
                slotState.currentRecord = undefined;
            }
        });
    }

    flush(): void {
        if (this.interactive) {
            this.clearPendingRender();
            this.renderInteractiveBoard();
            this.renderer?.done();
        }

        if (!this.summary) return;

        if (this.summary.failed > 0) {
            console.log(`\n${chalk.yellow(`${this.summary.failed} / ${this.summary.total} tests failed!`)}\n`);
            console.log(this.buildStatsLine());
            console.log('');
            this.displayFailureDetails();
        } else {
            console.log(`\n${chalk.green.bold(`${this.summary.total} tests executed successfully`)}\n`);
            console.log(this.buildStatsLine());
            console.log('');
        }
    }

    private scheduleRender(): void {
        if (!this.interactive) return;
        if (this.renderTimer) return;

        const runRender = () => {
            this.renderTimer = null;
            this.renderInteractiveBoard();
        };

        if (this.renderIntervalMs <= 0) {
            queueMicrotask(runRender);
            return;
        }

        this.renderTimer = setTimeout(runRender, this.renderIntervalMs);
    }

    private renderNow(): void {
        this.clearPendingRender();
        this.renderInteractiveBoard();
    }

    private clearPendingRender(): void {
        if (!this.renderTimer) return;
        clearTimeout(this.renderTimer);
        this.renderTimer = null;
    }

    private renderInteractiveBoard(): void {
        if (!this.plan) return;
        if (!this.renderer) return;

        const lines = this.renderSlotLines();
        if (!lines.length) return;
        this.renderer(lines.join('\n'));
    }

    private renderSlotLines(): string[] {
        const slots = Array.from(this.slotStates.values()).sort((left, right) => left.slot - right.slot);
        return slots.map((slotState) => this.formatSlotLine(slotState));
    }

    private displayFinishedRecord(record: LiveRecord): void {
        console.log(this.formatRecordLine(record));
    }

    private displayFailureDetails(): void {
        if (!this.summary) return;

        const failedRecords = this.summary.records.filter((record) => record.status === 'failed' && record.failure);
        if (!failedRecords.length) return;

        for (const record of failedRecords) {
            console.log(`${chalk.red(record.failurePhase || 'run')}: ${chalk.white(record.test.name)} - ${chalk.white(record.failure!.message)}`);

            if (record.failure?.stack) {
                record.failure.stack
                    .split('\n')
                    .filter((line) => line.trim().length > 0)
                    .slice(0, 8)
                    .forEach((line) => {
                        console.log(`${this.pad(4)}${chalk.dim(line.trim())}`);
                    });
            }

            console.log('');
        }
    }

    private buildStatsLine(): string {
        if (!this.summary) return '';

        const totalDurationMs = this.summary.durationMs;
        const finishedRecords = this.summary.records.filter((record) => typeof record.durationMs === 'number');
        const totalBodyTimeMs = finishedRecords.reduce((sum, record) => sum + (record.durationMs || 0), 0);
        const totalPrepareTimeMs = finishedRecords.reduce((sum, record) => sum + (record.prepareDurationMs || 0), 0);
        const totalHarnessTimeMs = totalBodyTimeMs + totalPrepareTimeMs;
        const averagePerTestMs = finishedRecords.length > 0 ? totalHarnessTimeMs / finishedRecords.length : 0;
        const averageParallelism = totalDurationMs > 0 ? totalHarnessTimeMs / totalDurationMs : 0;

        return chalk.dim(
            `avg/test ${this.formatStatDuration(averagePerTestMs)}`
            + ` | load ${this.formatStatDuration(totalPrepareTimeMs)}`
            + ` | total ${this.formatStatDuration(totalDurationMs)}`
            + ` | avg parallelism ${averageParallelism.toFixed(2)}x`,
        );
    }

    private displayWorkerTerminationEvent(record: LiveRecord): void {
        if (!record.workerTermination?.forced) return;
        console.log(chalk.dim(`worker terminated after ${record.workerTermination.graceMs} ms grace`));
    }

    private formatSlotLine(slotState: SlotState): string {
        const prefix = chalk.dim(`${slotState.slot.toString().padStart(2, '0')}`);

        if (slotState.state === 'busy' && slotState.currentRecord) {
            return `${prefix} ${chalk.dim('…')} ${chalk.white(this.describeTest(slotState.currentRecord))}${slotState.currentRecord.currentPhase ? chalk.dim(` [${slotState.currentRecord.currentPhase}]`) : ''}`;
        }

        if (slotState.lastRecord) {
            const lastLine = this.formatRecordLine(slotState.lastRecord);
            if (slotState.state === 'replacing') {
                return `${prefix} ${lastLine} ${chalk.dim('[replacing worker]')}`;
            }

            return `${prefix} ${lastLine}`;
        }

        if (slotState.state === 'replacing') {
            return `${prefix} ${chalk.dim('↻ replacing worker')}`;
        }

        return `${prefix} ${chalk.dim('· idle')}`;
    }

    private formatRecordLine(record: LiveRecord): string {
        const duration = this.formatDuration(record.durationMs || 0);

        if (!record.status) {
            return `${chalk.dim('…')} ${chalk.white(this.describeTest(record))}${record.currentPhase ? chalk.dim(` [${record.currentPhase}]`) : ''}`;
        }

        if (record.status === 'passed') {
            return `${chalk.green('✔')} ${chalk.white(this.describeTest(record))}${duration}`;
        }

        const parts: string[] = [];

        if (record.timeout) {
            parts.push(`timeout ${record.timeout.phase} ${record.timeout.timeoutMs} ms`);
        } else if (record.failurePhase) {
            parts.push(record.failurePhase);
        }

        if (record.teardownStatus && record.teardownStatus !== 'not-needed') {
            parts.push(`teardown ${record.teardownStatus}`);
        }

        if (record.workerTermination?.forced) {
            parts.push(`killed after ${record.workerTermination.graceMs} ms grace`);
        }

        if (!parts.length && record.failure?.message) {
            parts.push(record.failure.message);
        }

        return `${chalk.red('✖')} ${chalk.yellow(this.describeTest(record))}${duration}${parts.length ? chalk.dim(` [${parts.join(', ')}]`) : ''}`;
    }

    private describeTest(record: LiveRecord): string {
        const suiteLabel = record.test.suitePath.length ? `${record.test.suitePath.join(' > ')} > ` : '';
        return `${suiteLabel}${record.test.name}`;
    }

    private resolveSlot(workerId: string, workerSlot?: number): number | undefined {
        if (workerSlot !== undefined) {
            this.workerIdToSlot.set(workerId, workerSlot);
            return workerSlot;
        }

        const existing = this.workerIdToSlot.get(workerId);
        if (existing !== undefined) return existing;

        if (this.configuredWorkerSlots > 0) {
            for (let slot = 1; slot <= this.configuredWorkerSlots; slot++) {
                if (!Array.from(this.workerIdToSlot.values()).includes(slot)) {
                    this.workerIdToSlot.set(workerId, slot);
                    return slot;
                }
            }
        }

        return undefined;
    }

    private ensureSlot(slot: number): SlotState {
        const existing = this.slotStates.get(slot);
        if (existing) return existing;

        const state: SlotState = {
            slot,
            state: 'idle',
        };
        this.slotStates.set(slot, state);
        return state;
    }

    private formatDuration(durationMs: number): string {
        if (!durationMs || durationMs < 200) return '';
        return chalk.dim(` (${durationMs} ms)`);
    }

    private formatStatDuration(durationMs: number): string {
        if (durationMs >= 1000) {
            return `${(durationMs / 1000).toFixed(2)} s`;
        }

        return `${Math.round(durationMs)} ms`;
    }

    private pad(amount: number): string {
        return ' '.repeat(amount);
    }
}

