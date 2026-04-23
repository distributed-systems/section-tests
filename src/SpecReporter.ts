import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createLogUpdate } from 'log-update';
import chalk from './lib/chalk.js';
import {
    CollectedTest,
    LogLevel,
    Reporter,
    TestEvent,
    TestExecutionRecord,
    TestPhase,
    TestPlan,
    TestRunSummary,
} from './runtime-types.js';

type Renderer = ((message: string) => void) & { done: () => void; clear: () => void };

let cachedPackageVersion: string | undefined;

function readSectionTestsVersion(): string {
    if (cachedPackageVersion) return cachedPackageVersion;
    try {
        const packageJsonPath = fileURLToPath(new URL('../../package.json', import.meta.url));
        const data = JSON.parse(readFileSync(packageJsonPath, 'utf8')) as { version?: string };
        cachedPackageVersion = data.version && typeof data.version === 'string' ? data.version : '0.0.0';
    } catch {
        cachedPackageVersion = '0.0.0';
    }
    return cachedPackageVersion;
}

interface SpecReporterOptions {
    interactive?: boolean;
    output?: NodeJS.WriteStream;
    renderIntervalMs?: number;
    workerSlots?: number;
    createRenderer?: (stream: NodeJS.WriteStream) => Renderer;
    /** When true, show buffered `context` / test-log output after the run (and in CI). Default false. */
    showTestLogs?: boolean;
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

interface BufferedTestLog {
    testLabel: string;
    level: LogLevel;
    message: string;
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
    private bufferedTestLogs: BufferedTestLog[] = [];
    private readonly showTestLogs: boolean;

    constructor({
        interactive,
        output = process.stdout,
        renderIntervalMs = 50,
        workerSlots = 0,
        createRenderer = (stream) => createLogUpdate(stream) as Renderer,
        showTestLogs = false,
    }: SpecReporterOptions = {}) {
        this.output = output;
        this.interactive = interactive ?? Boolean(output.isTTY);
        this.renderer = this.interactive ? createRenderer(this.output) : null;
        this.renderIntervalMs = renderIntervalMs;
        this.configuredWorkerSlots = workerSlots;
        this.showTestLogs = showTestLogs;
    }

    setWorkerSlots(workerSlots: number): void {
        this.configuredWorkerSlots = Math.max(0, workerSlots);
    }

    private printRunHeader(): void {
        if (!this.interactive) return;

        const runBadge = '\u001B[46m\u001B[97m\u001B[1m RUN \u001B[0m';
        const versionPart = `\u001B[96mv${readSectionTestsVersion()}\u001B[0m`;
        const line = `${runBadge}  ${versionPart}  ${chalk.dim(process.cwd())}\n\n`;

        // Only write through the stream. Never use console: nested reporters / test harnesses
        // often use a non-TTY mock without write, and a console.log fallback would corrupt the
        // process TTY and interleave with log-update (same fd as the real board).
        if (typeof this.output.write !== 'function') {
            return;
        }
        this.output.write(line);
    }

    onPlan(plan: TestPlan): void {
        this.plan = plan;
        this.summary = undefined;
        this.bufferedTestLogs = [];
        this.records.clear();
        this.slotStates.clear();
        this.workerIdToSlot.clear();

        plan.tests.forEach((test: CollectedTest) => {
            this.records.set(test.id, {
                test,
                teardownStatus: test.source.hasTeardown ? 'not-run' : 'not-needed',
            });
        });

        this.printRunHeader();
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
            case 'test-log': {
                if (this.interactive) {
                    this.bufferedTestLogs.push({
                        testLabel: this.describeTest(record),
                        level: event.level,
                        message: event.message,
                    });
                } else if (this.showTestLogs) {
                    this.printTestLog(this.describeTest(record), event.level, event.message);
                }
                return;
            }
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
        } else {
            console.log('');
        }

        this.displayEndSummary();
        console.log('');
        this.displayBufferedTestLogs();
        if (this.summary.failed > 0) {
            this.displayFailureDetails();
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

    private printTestLog(testLabel: string, level: LogLevel, message: string): void {
        const levelTag = this.formatTestLogLevel(level);
        for (const [index, line] of message.split('\n').entries()) {
            if (index === 0) {
                console.log(`${chalk.dim(testLabel)} ${levelTag} ${line}`);
            } else {
                console.log(`${this.pad(4)}${line}`);
            }
        }
    }

    private formatTestLogLevel(level: LogLevel): string {
        const tag = `[${level}]`;
        switch (level) {
            case 'error':
                return chalk.red(tag);
            case 'warn':
                return chalk.yellow(tag);
            case 'success':
                return chalk.green(tag);
            case 'notice':
                return chalk.blue(tag);
            case 'info':
            default:
                return chalk.dim(tag);
        }
    }

    private displayBufferedTestLogs(): void {
        if (!this.showTestLogs) {
            this.bufferedTestLogs = [];
            return;
        }
        if (!this.bufferedTestLogs.length) return;

        console.log(chalk.dim('Test log (from context)'));
        for (const entry of this.bufferedTestLogs) {
            this.printTestLog(entry.testLabel, entry.level, entry.message);
        }
        console.log('');
        this.bufferedTestLogs = [];
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

    private displayEndSummary(): void {
        if (!this.summary) return;

        const s = this.summary;
        const labelWidth = 11;

        const fileToHasFailure = new Map<string, boolean>();
        for (const record of s.records) {
            const file = record.test.file;
            const was = fileToHasFailure.get(file) ?? false;
            fileToHasFailure.set(file, was || record.status !== 'passed');
        }
        const fileKeys = Array.from(fileToHasFailure.keys());
        const filesFailed = fileKeys.filter((f) => fileToHasFailure.get(f)).length;
        const filesPassed = fileKeys.length - filesFailed;
        const fileCount = fileKeys.length;

        const fileLine
            = filesFailed === 0
                ? `${chalk.green(`${filesPassed} passed`)} ${chalk.dim(`(${fileCount})`)}`
                : `${chalk.red(`${filesFailed} failed`)}${chalk.dim(' | ')}${chalk.green(`${filesPassed} passed`)} ${chalk.dim(`(${fileCount})`)}`;

        const testLine
            = s.failed === 0
                ? `${chalk.green(`${s.ok} passed`)} ${chalk.dim(`(${s.total})`)}`
                : `${chalk.red(`${s.failed} failed`)}${chalk.dim(' | ')}${chalk.green(`${s.ok} passed`)} ${chalk.dim(`(${s.total})`)}`;

        const totalDurationMs = s.durationMs;
        const finishedRecords = s.records.filter((record) => typeof record.durationMs === 'number');
        const totalBodyTimeMs = finishedRecords.reduce((sum, record) => sum + (record.durationMs || 0), 0);
        const totalPrepareTimeMs = finishedRecords.reduce((sum, record) => sum + (record.prepareDurationMs || 0), 0);
        const totalHarnessTimeMs = totalBodyTimeMs + totalPrepareTimeMs;
        const averageParallelism = totalDurationMs > 0 ? totalHarnessTimeMs / totalDurationMs : 0;
        const wallLabel = this.formatDurationClock(totalDurationMs);
        const details = chalk.dim(
            ` (load ${this.formatStatDuration(totalPrepareTimeMs)}`
            + `, tests ${this.formatStatDuration(totalBodyTimeMs)}`
            + `, total ${this.formatStatDuration(totalDurationMs)}`
            + `, parallel ${averageParallelism.toFixed(2)}x)`,
        );
        const durationLine = `${wallLabel}${details}`;

        console.log(`${'Test Files'.padStart(labelWidth)}  ${fileLine}`);
        console.log(`${'Tests'.padStart(labelWidth)}  ${testLine}`);
        console.log(`${'Duration'.padStart(labelWidth)}  ${durationLine}`);
    }

    /** Wall-clock duration in short form, e.g. 12.17s or 125 ms. */
    private formatDurationClock(durationMs: number): string {
        if (durationMs >= 1000) {
            return `${(durationMs / 1000).toFixed(2)}s`;
        }
        return `${Math.round(durationMs)} ms`;
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

