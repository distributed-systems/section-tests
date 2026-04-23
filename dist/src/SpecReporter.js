import { createLogUpdate } from 'log-update';
import chalk from './lib/chalk.js';
export default class SpecReporter {
    constructor({ interactive, output = process.stdout, renderIntervalMs = 50, workerSlots = 0, createRenderer = (stream) => createLogUpdate(stream), } = {}) {
        this.records = new Map();
        this.slotStates = new Map();
        this.workerIdToSlot = new Map();
        this.renderTimer = null;
        this.output = output;
        this.interactive = interactive ?? Boolean(output.isTTY);
        this.renderer = this.interactive ? createRenderer(this.output) : null;
        this.renderIntervalMs = renderIntervalMs;
        this.configuredWorkerSlots = workerSlots;
    }
    setWorkerSlots(workerSlots) {
        this.configuredWorkerSlots = Math.max(0, workerSlots);
    }
    onPlan(plan) {
        this.plan = plan;
        this.summary = undefined;
        this.records.clear();
        this.slotStates.clear();
        this.workerIdToSlot.clear();
        plan.tests.forEach((test) => {
            this.records.set(test.id, {
                test,
                teardownStatus: test.source.hasTeardown ? 'not-run' : 'not-needed',
            });
        });
    }
    onEvent(event) {
        const record = this.records.get(event.testId);
        if (!record)
            return;
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
        }
        else if (event.type === 'test-finished') {
            this.displayFinishedRecord(record);
        }
    }
    onSummary(summary) {
        this.summary = summary;
        summary.records.forEach((finalRecord) => {
            const liveRecord = this.records.get(finalRecord.test.id);
            if (!liveRecord)
                return;
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
            if (!slot)
                return;
            const slotState = this.ensureSlot(slot);
            slotState.lastRecord = liveRecord;
            if (slotState.state !== 'busy') {
                slotState.currentRecord = undefined;
            }
        });
    }
    flush() {
        if (this.interactive) {
            this.clearPendingRender();
            this.renderInteractiveBoard();
            this.renderer?.done();
        }
        if (!this.summary)
            return;
        if (this.summary.failed > 0) {
            console.log(`\n${chalk.yellow(`${this.summary.failed} / ${this.summary.total} tests failed!`)}\n`);
            console.log(this.buildStatsLine());
            console.log('');
            this.displayFailureDetails();
        }
        else {
            console.log(`\n${chalk.green.bold(`${this.summary.total} tests executed successfully`)}\n`);
            console.log(this.buildStatsLine());
            console.log('');
        }
    }
    scheduleRender() {
        if (!this.interactive)
            return;
        if (this.renderTimer)
            return;
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
    renderNow() {
        this.clearPendingRender();
        this.renderInteractiveBoard();
    }
    clearPendingRender() {
        if (!this.renderTimer)
            return;
        clearTimeout(this.renderTimer);
        this.renderTimer = null;
    }
    renderInteractiveBoard() {
        if (!this.plan)
            return;
        if (!this.renderer)
            return;
        const lines = this.renderSlotLines();
        if (!lines.length)
            return;
        this.renderer(lines.join('\n'));
    }
    renderSlotLines() {
        const slots = Array.from(this.slotStates.values()).sort((left, right) => left.slot - right.slot);
        return slots.map((slotState) => this.formatSlotLine(slotState));
    }
    displayFinishedRecord(record) {
        console.log(this.formatRecordLine(record));
    }
    displayFailureDetails() {
        if (!this.summary)
            return;
        const failedRecords = this.summary.records.filter((record) => record.status === 'failed' && record.failure);
        if (!failedRecords.length)
            return;
        for (const record of failedRecords) {
            console.log(`${chalk.red(record.failurePhase || 'run')}: ${chalk.white(record.test.name)} - ${chalk.white(record.failure.message)}`);
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
    buildStatsLine() {
        if (!this.summary)
            return '';
        const totalDurationMs = this.summary.durationMs;
        const finishedRecords = this.summary.records.filter((record) => typeof record.durationMs === 'number');
        const totalBodyTimeMs = finishedRecords.reduce((sum, record) => sum + (record.durationMs || 0), 0);
        const totalPrepareTimeMs = finishedRecords.reduce((sum, record) => sum + (record.prepareDurationMs || 0), 0);
        const totalHarnessTimeMs = totalBodyTimeMs + totalPrepareTimeMs;
        const averagePerTestMs = finishedRecords.length > 0 ? totalHarnessTimeMs / finishedRecords.length : 0;
        const averageParallelism = totalDurationMs > 0 ? totalHarnessTimeMs / totalDurationMs : 0;
        return chalk.dim(`avg/test ${this.formatStatDuration(averagePerTestMs)}`
            + ` | load ${this.formatStatDuration(totalPrepareTimeMs)}`
            + ` | total ${this.formatStatDuration(totalDurationMs)}`
            + ` | avg parallelism ${averageParallelism.toFixed(2)}x`);
    }
    displayWorkerTerminationEvent(record) {
        if (!record.workerTermination?.forced)
            return;
        console.log(chalk.dim(`worker terminated after ${record.workerTermination.graceMs} ms grace`));
    }
    formatSlotLine(slotState) {
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
    formatRecordLine(record) {
        const duration = this.formatDuration(record.durationMs || 0);
        if (!record.status) {
            return `${chalk.dim('…')} ${chalk.white(this.describeTest(record))}${record.currentPhase ? chalk.dim(` [${record.currentPhase}]`) : ''}`;
        }
        if (record.status === 'passed') {
            return `${chalk.green('✔')} ${chalk.white(this.describeTest(record))}${duration}`;
        }
        const parts = [];
        if (record.timeout) {
            parts.push(`timeout ${record.timeout.phase} ${record.timeout.timeoutMs} ms`);
        }
        else if (record.failurePhase) {
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
    describeTest(record) {
        const suiteLabel = record.test.suitePath.length ? `${record.test.suitePath.join(' > ')} > ` : '';
        return `${suiteLabel}${record.test.name}`;
    }
    resolveSlot(workerId, workerSlot) {
        if (workerSlot !== undefined) {
            this.workerIdToSlot.set(workerId, workerSlot);
            return workerSlot;
        }
        const existing = this.workerIdToSlot.get(workerId);
        if (existing !== undefined)
            return existing;
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
    ensureSlot(slot) {
        const existing = this.slotStates.get(slot);
        if (existing)
            return existing;
        const state = {
            slot,
            state: 'idle',
        };
        this.slotStates.set(slot, state);
        return state;
    }
    formatDuration(durationMs) {
        if (!durationMs || durationMs < 200)
            return '';
        return chalk.dim(` (${durationMs} ms)`);
    }
    formatStatDuration(durationMs) {
        if (durationMs >= 1000) {
            return `${(durationMs / 1000).toFixed(2)} s`;
        }
        return `${Math.round(durationMs)} ms`;
    }
    pad(amount) {
        return ' '.repeat(amount);
    }
}
//# sourceMappingURL=SpecReporter.js.map