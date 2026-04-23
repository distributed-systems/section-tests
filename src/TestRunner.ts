import { availableParallelism } from 'node:os';
import { Worker } from 'node:worker_threads';
import glob from '@distributed-systems/glob';
import { DEFAULT_TEST_TIMEOUT } from './api.js';
import SpecReporter from './SpecReporter.js';
import { collectTestPlan } from './collection.js';
import {
    CollectedTest,
    Reporter,
    SerializedError,
    TeardownStatus,
    TestEvent,
    TestExecutionRecord,
    TestRunSummary,
    TimeoutInfo,
    TimeoutPolicy,
    WorkerTerminationInfo,
} from './runtime-types.js';

export const SECTION_TESTS_JSON_SUMMARY_PREFIX = 'SECTION_TESTS_SUMMARY:';

interface TestRunnerOptions {
    patterns: string[];
    jsonSummary?: boolean;
    jobs?: number;
    reporters?: Reporter[];
    defaultTimeoutMs?: number;
    timeoutGraceMs?: number;
}

interface TimedOutWorkerState {
    test: CollectedTest;
    worker: Worker;
    timedOutAt: number;
    timeout: TimeoutInfo;
    exitPromise: Promise<void>;
    resolveExit: () => void;
    exited: boolean;
    finishedEventSeen: boolean;
    teardownStarted: boolean;
    workerTermination?: WorkerTerminationInfo;
}

export default class TestRunner {
    patterns: string[];
    files?: string[];
    jsonSummary: boolean;
    jobs: number;
    reporters: Reporter[];
    timeoutPolicy: TimeoutPolicy;
    timedOutWorkers: Map<string, TimedOutWorkerState>;

    constructor({
        patterns,
        jsonSummary = false,
        jobs = Math.max(1, availableParallelism()),
        reporters = [],
        defaultTimeoutMs = DEFAULT_TEST_TIMEOUT,
        timeoutGraceMs,
    }: TestRunnerOptions) {
        this.patterns = patterns;
        this.jsonSummary = jsonSummary;
        this.jobs = Math.max(1, jobs);
        this.reporters = reporters.length ? reporters : [new SpecReporter()];
        this.timeoutPolicy = {
            defaultTimeoutMs,
            timeoutGraceMs: timeoutGraceMs ?? defaultTimeoutMs * 2,
        };
        this.timedOutWorkers = new Map();
    }

    async execute(): Promise<void> {
        const start = Date.now();
        await this.resolvePatterns();

        const plan = await collectTestPlan(this.files || [], {
            defaultTimeoutMs: this.timeoutPolicy.defaultTimeoutMs,
        });
        this.reporters.forEach((reporter) => reporter.onPlan?.(plan));

        const records = new Map<string, TestExecutionRecord>(
            plan.tests.map((test) => [test.id, {
                test,
                events: [],
                teardownStatus: test.source.hasTeardown ? 'not-run' : 'not-needed',
            }]),
        );

        const handleEvent = (event: TestEvent) => {
            const record = records.get(event.testId);
            if (record) {
                record.events.push(event);

                switch (event.type) {
                    case 'test-timeout':
                        record.timeout = event.timeout;
                        break;
                    case 'worker-terminated':
                        record.workerTermination = event.workerTermination;
                        break;
                    case 'test-finished':
                        record.status = event.status;
                        record.durationMs = event.durationMs;
                        record.failure = event.failure;
                        record.failurePhase = event.failurePhase;
                        record.timeout = event.timeout;
                        record.teardownStatus = event.teardownStatus;
                        record.workerTermination = event.workerTermination ?? record.workerTermination;
                        break;
                }
            }

            this.reporters.forEach((reporter) => reporter.onEvent(event));
        };

        const parallelTests = plan.tests.filter((test) => test.mode !== 'serial');
        const serialTests = plan.tests.filter((test) => test.mode === 'serial');

        await this.executeQueue(parallelTests, this.jobs, handleEvent);
        await this.executeQueue(serialTests, 1, handleEvent);
        await this.drainTimedOutWorkers(handleEvent);

        const orderedRecords = plan.tests.map((test) => {
            const record = records.get(test.id);

            if (record) return record;

            return {
                test,
                events: [],
                status: 'failed' as const,
                durationMs: 0,
                failure: {
                    name: 'Error',
                    message: 'Missing test result.',
                },
                failurePhase: 'worker' as const,
                teardownStatus: (test.source.hasTeardown ? 'not-run' : 'not-needed') as TeardownStatus,
            };
        });

        const summary: TestRunSummary = {
            ok: orderedRecords.filter((record) => record.status === 'passed').length,
            failed: orderedRecords.filter((record) => record.status !== 'passed').length,
            total: orderedRecords.length,
            durationMs: Date.now() - start,
            pass: orderedRecords.every((record) => record.status === 'passed'),
            records: orderedRecords,
        };

        this.reporters.forEach((reporter) => reporter.onSummary?.(summary));
        this.reporters.forEach((reporter) => reporter.flush?.());

        if (this.jsonSummary) this.emitJsonSummary(summary);

        process.exit(summary.pass ? 0 : 1);
    }

    emitJsonSummary(summary: TestRunSummary): void {
        process.stderr.write(
            `${SECTION_TESTS_JSON_SUMMARY_PREFIX}${JSON.stringify({
                type: 'section-tests.suite-end',
                ok: summary.ok,
                failed: summary.failed,
                total: summary.total,
                durationMs: summary.durationMs,
                pass: summary.pass,
            })}\n`,
        );
    }

    async resolvePatterns(): Promise<void> {
        this.files = await glob(process.cwd(), ...this.patterns);
    }

    async executeQueue(
        tests: CollectedTest[],
        maxWorkers: number,
        handleEvent: (event: TestEvent) => void,
    ): Promise<void> {
        if (!tests.length) return;

        const queue = [...tests];
        const active = new Set<Promise<void>>();

        const launchNext = async (): Promise<void> => {
            const next = queue.shift();
            if (!next) return;

            const execution = this.executeTest(next, handleEvent)
                .catch((err) => {
                    handleEvent(this.buildWorkerFailureEvent(
                        next,
                        err,
                        undefined,
                        next.source.hasTeardown ? 'not-run' : 'not-needed',
                    ));
                })
                .finally(() => {
                    active.delete(execution);
                });

            active.add(execution);

            if (active.size >= maxWorkers) {
                await Promise.race(active);
            }

            await launchNext();
        };

        await launchNext();
        await Promise.all(active);
    }

    executeTest(test: CollectedTest, handleEvent: (event: TestEvent) => void): Promise<void> {
        return new Promise((resolve) => {
            const worker = new Worker(new URL('./worker.js', import.meta.url), {
                workerData: test,
            });

            let finished = false;
            let logicalComplete = false;
            let failureReported = false;
            let resolveExit!: () => void;
            const exitPromise = new Promise<void>((exitResolve) => {
                resolveExit = exitResolve;
            });

            const state: TimedOutWorkerState = {
                test,
                worker,
                timedOutAt: 0,
                timeout: {
                    phase: 'run',
                    timeoutMs: test.timeout,
                },
                exitPromise,
                resolveExit,
                exited: false,
                finishedEventSeen: false,
                teardownStarted: false,
            };

            const resolveLogical = () => {
                if (logicalComplete) return;
                logicalComplete = true;
                resolve();
            };

            worker.on('message', (event: TestEvent) => {
                if (event.type === 'phase-started' && event.phase === 'teardown') {
                    state.teardownStarted = true;
                }

                if (event.type === 'test-timeout') {
                    state.timedOutAt = state.timedOutAt || Date.now();
                    state.timeout = event.timeout;
                    this.timedOutWorkers.set(test.id, state);
                    handleEvent(event);
                    resolveLogical();
                    return;
                }

                handleEvent(event);

                if (event.type === 'test-finished') {
                    finished = true;
                    state.finishedEventSeen = true;

                    if (event.timeout) {
                        state.timedOutAt = state.timedOutAt || Date.now();
                        state.timeout = event.timeout;
                        this.timedOutWorkers.set(test.id, state);
                    }

                    resolveLogical();
                }

                if (event.type === 'worker-terminated') {
                    state.workerTermination = event.workerTermination;
                }
            });

            worker.on('error', (err) => {
                if (!finished && !failureReported) {
                    failureReported = true;
                    handleEvent(this.buildWorkerFailureEvent(
                        test,
                        err,
                        undefined,
                        test.source.hasTeardown ? 'not-run' : 'not-needed',
                    ));
                    resolveLogical();
                }
            });

            worker.on('exit', (code) => {
                state.exited = true;
                state.resolveExit();
                this.timedOutWorkers.delete(test.id);

                if (state.timedOutAt && !state.finishedEventSeen && !failureReported) {
                    failureReported = true;
                    handleEvent(this.buildTimedOutFailureEvent(state));
                }

                if (!finished && code !== 0 && !failureReported) {
                    failureReported = true;
                    handleEvent(this.buildWorkerFailureEvent(
                        test,
                        new Error(`Worker exited with code ${code}.`),
                        state.workerTermination,
                        test.source.hasTeardown ? 'not-run' : 'not-needed',
                    ));
                }

                resolveLogical();
            });
        });
    }

    async drainTimedOutWorkers(handleEvent: (event: TestEvent) => void): Promise<void> {
        const states = Array.from(this.timedOutWorkers.values());

        await Promise.all(states.map(async (state) => {
            if (state.exited) return;

            const deadline = state.timedOutAt + this.timeoutPolicy.timeoutGraceMs;
            const remainingMs = Math.max(0, deadline - Date.now());

            if (remainingMs > 0) {
                await Promise.race([
                    state.exitPromise,
                    new Promise<void>((resolve) => setTimeout(resolve, remainingMs)),
                ]);
            }

            if (state.exited) return;

            const workerTermination: WorkerTerminationInfo = {
                forced: true,
                reason: 'timeout-grace-expired',
                graceMs: this.timeoutPolicy.timeoutGraceMs,
            };
            state.workerTermination = workerTermination;

            handleEvent({
                type: 'worker-terminated',
                testId: state.test.id,
                file: state.test.file,
                suitePath: state.test.suitePath,
                testName: state.test.name,
                workerTermination,
            });

            if (!state.finishedEventSeen) {
                handleEvent(this.buildTimedOutFailureEvent(state, workerTermination));
                state.finishedEventSeen = true;
            }

            await state.worker.terminate();
            await state.exitPromise.catch(() => undefined);
            this.timedOutWorkers.delete(state.test.id);
        }));
    }

    buildTimedOutFailureEvent(
        state: TimedOutWorkerState,
        workerTermination?: WorkerTerminationInfo,
    ): TestEvent {
        return {
            type: 'test-finished',
            testId: state.test.id,
            file: state.test.file,
            suitePath: state.test.suitePath,
            testName: state.test.name,
            status: 'failed',
            durationMs: 0,
            failure: {
                name: 'TimeoutError',
                message: `The ${state.timeout.phase} phase timed out after ${state.timeout.timeoutMs} milliseconds.`,
            },
            failurePhase: state.timeout.phase,
            timeout: state.timeout,
            teardownStatus: this.getInterruptedTeardownStatus(state),
            workerTermination,
        };
    }

    getInterruptedTeardownStatus(state: TimedOutWorkerState): TeardownStatus {
        if (!state.test.source.hasTeardown) return 'not-needed';
        if (state.timeout.phase === 'teardown') return 'timed-out';
        if (state.teardownStarted) return 'interrupted';
        return 'not-run';
    }

    buildWorkerFailureEvent(
        test: CollectedTest,
        err: unknown,
        workerTermination: WorkerTerminationInfo | undefined,
        teardownStatus: TeardownStatus,
    ): TestEvent {
        const failure = this.serializeError(err);
        return {
            type: 'test-finished',
            testId: test.id,
            file: test.file,
            suitePath: test.suitePath,
            testName: test.name,
            status: 'failed',
            durationMs: 0,
            failure,
            failurePhase: 'worker',
            teardownStatus,
            workerTermination,
        };
    }

    serializeError(err: unknown): SerializedError {
        if (err instanceof Error) {
            return {
                name: err.name,
                message: err.message,
                stack: err.stack,
            };
        }

        return {
            name: 'Error',
            message: String(err),
        };
    }
}

