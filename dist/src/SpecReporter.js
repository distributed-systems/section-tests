import { createLogUpdate } from 'log-update';
import chalk from './lib/chalk.js';
const levelColorMap = new Map([
    ['error', 'red'],
    ['warn', 'yellow'],
    ['success', 'green'],
    ['info', 'white'],
    ['notice', 'dim'],
]);
export default class SpecReporter {
    constructor() {
        this.records = new Map();
        this.startedTests = new Set();
        this.startedOrder = [];
        this.interactive = Boolean(process.stdout.isTTY);
        this.logUpdate = this.interactive ? createLogUpdate(process.stdout) : null;
    }
    onPlan(plan) {
        this.plan = plan;
        this.startedTests.clear();
        this.startedOrder = [];
        this.records = new Map(plan.tests.map((test) => [
            test.id,
            {
                test,
                events: [],
            },
        ]));
    }
    onEvent(event) {
        const record = this.records.get(event.testId);
        if (!record)
            return;
        record.events.push(event);
        switch (event.type) {
            case 'test-started':
                if (!this.startedTests.has(record.test.id)) {
                    this.startedTests.add(record.test.id);
                    this.startedOrder.push(record.test.id);
                }
                break;
            case 'test-timeout':
                record.timeout = event.timeout;
                break;
            case 'worker-terminated':
                record.workerTermination = event.workerTermination;
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
                break;
        }
        if (this.interactive) {
            this.renderInteractiveBoard();
        }
        else if (event.type === 'test-finished') {
            this.displayFinishedRecord(record);
        }
    }
    onSummary(summary) {
        this.summary = summary;
        this.records = new Map(summary.records.map((record) => [record.test.id, record]));
    }
    flush() {
        if (this.interactive) {
            this.renderInteractiveBoard();
            this.logUpdate?.done();
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
    renderInteractiveBoard() {
        if (!this.plan)
            return;
        if (!this.logUpdate)
            return;
        const lines = this.startedOrder
            .map((testId) => this.records.get(testId))
            .filter((record) => Boolean(record))
            .map((record) => this.formatRecordLine(record));
        if (!lines.length)
            return;
        this.logUpdate(lines.join('\n'));
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
    formatRecordLine(record) {
        const suiteLabel = record.test.suitePath.length ? `${record.test.suitePath.join(' > ')} > ` : '';
        const duration = this.formatDuration(record.durationMs || 0);
        if (!record.status) {
            const phase = this.getCurrentPhase(record);
            const status = chalk.dim('…');
            const suffix = phase ? chalk.dim(` [${phase}]`) : '';
            return `${status} ${chalk.white(`${suiteLabel}${record.test.name}`)}${suffix}`;
        }
        if (record.status === 'passed') {
            return `${chalk.green('✔')} ${chalk.white(`${suiteLabel}${record.test.name}`)}${duration}`;
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
        return `${chalk.red('✖')} ${chalk.yellow(`${suiteLabel}${record.test.name}`)}${duration}${parts.length ? chalk.dim(` [${parts.join(', ')}]`) : ''}`;
    }
    getCurrentPhase(record) {
        for (let index = record.events.length - 1; index >= 0; index--) {
            const event = record.events[index];
            if (event.type === 'phase-started')
                return event.phase;
        }
        return undefined;
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