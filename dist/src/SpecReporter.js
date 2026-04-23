import { basename } from 'node:path';
import { createLogUpdate } from 'log-update';
import chalk from './lib/chalk.js';
export default class SpecReporter {
    constructor({ interactive, output = process.stdout, renderIntervalMs = 50, compactThreshold = 80, maxRunningTests = 6, createRenderer = (stream) => createLogUpdate(stream), } = {}) {
        this.records = new Map();
        this.suiteProgress = new Map();
        this.suiteOrder = [];
        this.startedOrder = [];
        this.runningOrder = [];
        this.mode = 'detailed';
        this.renderTimer = null;
        this.output = output;
        this.interactive = interactive ?? Boolean(output.isTTY);
        this.renderer = this.interactive ? createRenderer(this.output) : null;
        this.renderIntervalMs = renderIntervalMs;
        this.compactThreshold = compactThreshold;
        this.maxRunningTests = maxRunningTests;
    }
    onPlan(plan) {
        this.plan = plan;
        this.summary = undefined;
        this.mode = plan.tests.length > this.compactThreshold ? 'compact' : 'detailed';
        this.startedOrder = [];
        this.runningOrder = [];
        this.suiteOrder = [];
        this.records.clear();
        this.suiteProgress.clear();
        plan.tests.forEach((test) => {
            const suiteInfo = this.getSuiteInfo(test);
            const suite = this.getOrCreateSuiteProgress(suiteInfo.key, suiteInfo.label);
            suite.total += 1;
            this.records.set(test.id, {
                test,
                suiteKey: suiteInfo.key,
                suiteLabel: suiteInfo.label,
                started: false,
                teardownStatus: test.source.hasTeardown ? 'not-run' : 'not-needed',
            });
        });
    }
    onEvent(event) {
        const record = this.records.get(event.testId);
        if (!record)
            return;
        const suite = this.suiteProgress.get(record.suiteKey);
        switch (event.type) {
            case 'test-started':
                if (!record.started) {
                    record.started = true;
                    this.startedOrder.push(record.test.id);
                    this.runningOrder.push(record.test.id);
                    suite.running += 1;
                }
                break;
            case 'phase-started':
                record.currentPhase = event.phase;
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
                if (suite && record.started) {
                    suite.running = Math.max(0, suite.running - 1);
                    suite.completed += 1;
                    if (event.status === 'passed')
                        suite.passed += 1;
                    else
                        suite.failed += 1;
                    if (event.timeout)
                        suite.timedOut += 1;
                }
                this.runningOrder = this.runningOrder.filter((testId) => testId !== record.test.id);
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
        });
    }
    flush() {
        if (this.interactive) {
            this.renderNow();
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
        if (this.renderTimer) {
            clearTimeout(this.renderTimer);
            this.renderTimer = null;
        }
        this.renderInteractiveBoard();
    }
    renderInteractiveBoard() {
        if (!this.plan)
            return;
        if (!this.renderer)
            return;
        const lines = this.mode === 'compact'
            ? this.renderCompactLines()
            : this.renderDetailedLines();
        if (!lines.length)
            return;
        this.renderer(lines.join('\n'));
    }
    renderDetailedLines() {
        return this.startedOrder
            .map((testId) => this.records.get(testId))
            .filter((record) => Boolean(record))
            .map((record) => this.formatRecordLine(record));
    }
    renderCompactLines() {
        const total = this.plan?.tests.length || 0;
        const suiteValues = this.suiteOrder
            .map((key) => this.suiteProgress.get(key))
            .filter((suite) => Boolean(suite));
        const completed = suiteValues.reduce((sum, suite) => sum + suite.completed, 0);
        const running = suiteValues.reduce((sum, suite) => sum + suite.running, 0);
        const failed = suiteValues.reduce((sum, suite) => sum + suite.failed, 0);
        const timedOut = suiteValues.reduce((sum, suite) => sum + suite.timedOut, 0);
        const lines = [
            chalk.dim(`progress ${completed}/${total} finished`
                + ` | running ${running}`
                + ` | failed ${failed}`
                + (timedOut ? ` | timed out ${timedOut}` : '')),
            ...suiteValues.map((suite) => this.formatSuiteLine(suite)),
        ];
        const runningRecords = this.runningOrder
            .map((testId) => this.records.get(testId))
            .filter((record) => Boolean(record))
            .slice(0, this.maxRunningTests);
        if (runningRecords.length) {
            lines.push('');
            lines.push(chalk.dim('running now'));
            runningRecords.forEach((record) => {
                const suffix = record.currentPhase ? chalk.dim(` [${record.currentPhase}]`) : '';
                lines.push(`… ${chalk.white(`${record.suiteLabel} > ${record.test.name}`)}${suffix}`);
            });
            const remaining = this.runningOrder.length - runningRecords.length;
            if (remaining > 0) {
                lines.push(chalk.dim(`… and ${remaining} more running`));
            }
        }
        return lines;
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
            const status = chalk.dim('…');
            const suffix = record.currentPhase ? chalk.dim(` [${record.currentPhase}]`) : '';
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
    formatSuiteLine(suite) {
        const icon = suite.failed > 0 ? chalk.red('✖') : suite.running > 0 ? chalk.dim('…') : chalk.green('✔');
        const parts = [
            `${suite.completed}/${suite.total}`,
            `${suite.running} running`,
            `${suite.passed} passed`,
        ];
        if (suite.failed)
            parts.push(`${suite.failed} failed`);
        if (suite.timedOut)
            parts.push(`${suite.timedOut} timed out`);
        return `${icon} ${chalk.white(suite.label)} ${chalk.dim(parts.join(' | '))}`;
    }
    getSuiteInfo(test) {
        if (test.suitePath.length) {
            return {
                key: `suite:${test.file}:${test.suitePath[0]}`,
                label: test.suitePath[0],
            };
        }
        return {
            key: `file:${test.file}`,
            label: basename(test.file),
        };
    }
    getOrCreateSuiteProgress(key, label) {
        const existing = this.suiteProgress.get(key);
        if (existing)
            return existing;
        const suite = {
            key,
            label,
            total: 0,
            running: 0,
            completed: 0,
            passed: 0,
            failed: 0,
            timedOut: 0,
        };
        this.suiteProgress.set(key, suite);
        this.suiteOrder.push(key);
        return suite;
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