import { availableParallelism } from 'node:os';
import { Worker } from 'node:worker_threads';
import glob from '@distributed-systems/glob';
import { DEFAULT_TEST_TIMEOUT } from './api.js';
import SpecReporter from './SpecReporter.js';
import { collectTestPlan } from './collection.js';
export const SECTION_TESTS_JSON_SUMMARY_PREFIX = 'SECTION_TESTS_SUMMARY:';
export default class TestRunner {
    constructor({ patterns, jsonSummary = false, showTestLogs = false, jobs = Math.max(1, availableParallelism()), reporters = [], defaultTimeoutMs = DEFAULT_TEST_TIMEOUT, timeoutGraceMs, }) {
        this.patterns = patterns;
        this.jsonSummary = jsonSummary;
        this.showTestLogs = showTestLogs;
        this.jobs = Math.max(1, jobs);
        this.reporters = reporters.length
            ? reporters
            : [new SpecReporter({ workerSlots: this.jobs, showTestLogs: this.showTestLogs })];
        this.timeoutPolicy = {
            defaultTimeoutMs,
            timeoutGraceMs: timeoutGraceMs ?? defaultTimeoutMs * 2,
        };
        this.timedOutWorkers = new Map();
        this.idleWorkers = [];
        this.idleWaiters = [];
        this.workerSeq = 0;
        this.shuttingDown = false;
    }
    async execute() {
        const start = Date.now();
        await this.resolvePatterns();
        const plan = await collectTestPlan(this.files || [], {
            defaultTimeoutMs: this.timeoutPolicy.defaultTimeoutMs,
        });
        const parallelTests = plan.tests.filter((test) => test.mode !== 'serial');
        const serialTests = plan.tests.filter((test) => test.mode === 'serial');
        const workerSlots = Math.max(1, Math.min(this.jobs, parallelTests.length || 1));
        this.reporters.forEach((reporter) => {
            if (reporter instanceof SpecReporter) {
                reporter.setWorkerSlots(workerSlots);
            }
        });
        this.reporters.forEach((reporter) => reporter.onPlan?.(plan));
        const records = new Map(plan.tests.map((test) => [test.id, {
                test,
                events: [],
                teardownStatus: test.source.hasTeardown ? 'not-run' : 'not-needed',
            }]));
        const handleEvent = (event) => {
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
                        record.prepareDurationMs = event.prepareDurationMs;
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
        console.log(`Running ${plan.tests.length} tests with up to ${workerSlots} in parallel`
            + (serialTests.length ? ` (${serialTests.length} serial)` : ''));
        console.log('');
        await this.initializePool(handleEvent, workerSlots);
        await this.executeQueue(parallelTests, workerSlots, handleEvent);
        await this.executeQueue(serialTests, 1, handleEvent);
        await this.drainTimedOutWorkers(handleEvent);
        this.shuttingDown = true;
        const orderedRecords = plan.tests.map((test) => {
            const record = records.get(test.id);
            if (record)
                return record;
            return {
                test,
                events: [],
                status: 'failed',
                durationMs: 0,
                prepareDurationMs: 0,
                failure: {
                    name: 'Error',
                    message: 'Missing test result.',
                },
                failurePhase: 'worker',
                teardownStatus: (test.source.hasTeardown ? 'not-run' : 'not-needed'),
            };
        });
        const summary = {
            ok: orderedRecords.filter((record) => record.status === 'passed').length,
            failed: orderedRecords.filter((record) => record.status !== 'passed').length,
            total: orderedRecords.length,
            durationMs: Date.now() - start,
            pass: orderedRecords.every((record) => record.status === 'passed'),
            records: orderedRecords,
        };
        this.reporters.forEach((reporter) => reporter.onSummary?.(summary));
        this.reporters.forEach((reporter) => reporter.flush?.());
        if (this.jsonSummary)
            this.emitJsonSummary(summary);
        process.exit(summary.pass ? 0 : 1);
    }
    emitJsonSummary(summary) {
        process.stderr.write(`${SECTION_TESTS_JSON_SUMMARY_PREFIX}${JSON.stringify({
            type: 'section-tests.suite-end',
            ok: summary.ok,
            failed: summary.failed,
            total: summary.total,
            durationMs: summary.durationMs,
            pass: summary.pass,
        })}\n`);
    }
    async resolvePatterns() {
        this.files = await glob(process.cwd(), ...this.patterns);
    }
    async executeQueue(tests, maxWorkers, handleEvent) {
        if (!tests.length)
            return;
        const queue = [...tests];
        const active = new Set();
        while (queue.length || active.size) {
            while (queue.length && active.size < maxWorkers) {
                const worker = await this.acquireIdleWorker();
                const next = queue.shift();
                if (!worker || !next)
                    break;
                const execution = this.dispatchTest(worker, next)
                    .catch((err) => {
                    handleEvent(this.buildWorkerFailureEvent(next, worker.id, worker.slot, err, undefined, next.source.hasTeardown ? 'not-run' : 'not-needed'));
                })
                    .finally(() => {
                    active.delete(execution);
                });
                active.add(execution);
            }
            if (active.size) {
                await Promise.race(active);
            }
        }
    }
    async drainTimedOutWorkers(handleEvent) {
        const states = Array.from(this.timedOutWorkers.values());
        await Promise.all(states.map(async (state) => {
            if (state.exited)
                return;
            const deadline = state.timedOutAt + this.timeoutPolicy.timeoutGraceMs;
            const remainingMs = Math.max(0, deadline - Date.now());
            if (remainingMs > 0) {
                await Promise.race([
                    state.exitPromise,
                    new Promise((resolve) => setTimeout(resolve, remainingMs)),
                ]);
            }
            if (state.exited)
                return;
            const workerTermination = {
                forced: true,
                reason: 'timeout-grace-expired',
                graceMs: this.timeoutPolicy.timeoutGraceMs,
            };
            state.workerTermination = workerTermination;
            const test = state.currentJob?.test;
            if (!test)
                return;
            handleEvent({
                type: 'worker-terminated',
                workerId: state.id,
                workerSlot: state.slot,
                testId: test.id,
                file: test.file,
                suitePath: test.suitePath,
                testName: test.name,
                workerTermination,
            });
            if (!state.finishedEventSeen) {
                handleEvent(this.buildTimedOutFailureEvent(state, workerTermination));
                state.finishedEventSeen = true;
                state.currentJob = undefined;
            }
            await state.worker.terminate();
            await state.exitPromise.catch(() => undefined);
            this.timedOutWorkers.delete(state.id);
        }));
    }
    buildTimedOutFailureEvent(state, workerTermination) {
        const test = state.currentJob?.test;
        if (!test) {
            throw new Error(`Timed out worker ${state.id} is missing current test state.`);
        }
        return {
            type: 'test-finished',
            workerId: state.id,
            workerSlot: state.slot,
            testId: test.id,
            file: test.file,
            suitePath: test.suitePath,
            testName: test.name,
            status: 'failed',
            durationMs: 0,
            prepareDurationMs: 0,
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
    getInterruptedTeardownStatus(state) {
        const test = state.currentJob?.test;
        if (!test?.source.hasTeardown)
            return 'not-needed';
        if (state.timeout.phase === 'teardown')
            return 'timed-out';
        if (state.teardownStarted)
            return 'interrupted';
        return 'not-run';
    }
    buildWorkerFailureEvent(test, workerId, workerSlot, err, workerTermination, teardownStatus) {
        const failure = this.serializeError(err);
        return {
            type: 'test-finished',
            workerId,
            workerSlot,
            testId: test.id,
            file: test.file,
            suitePath: test.suitePath,
            testName: test.name,
            status: 'failed',
            durationMs: 0,
            prepareDurationMs: 0,
            failure,
            failurePhase: 'worker',
            teardownStatus,
            workerTermination,
        };
    }
    serializeError(err) {
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
    async initializePool(handleEvent, workerSlots) {
        await Promise.all(Array.from({ length: workerSlots }, (_, index) => this.spawnWorker(handleEvent, index + 1)));
    }
    async spawnWorker(handleEvent, slot) {
        const id = `worker-${++this.workerSeq}`;
        let resolveExit;
        let resolveReady;
        const exitPromise = new Promise((exitResolve) => {
            resolveExit = exitResolve;
        });
        const readyPromise = new Promise((readyResolve) => {
            resolveReady = readyResolve;
        });
        const worker = new Worker(new URL('./worker.js', import.meta.url), {
            workerData: {
                workerId: id,
            },
        });
        const state = {
            id,
            slot,
            worker,
            timedOutAt: 0,
            timeout: {
                phase: 'run',
                timeoutMs: this.timeoutPolicy.defaultTimeoutMs,
            },
            exitPromise,
            resolveExit,
            exited: false,
            finishedEventSeen: false,
            teardownStarted: false,
            replacementSpawned: false,
            state: 'starting',
        };
        worker.on('message', (message) => {
            if (message.type === 'worker-ready') {
                state.state = 'idle';
                this.releaseIdleWorker(state);
                resolveReady();
                return;
            }
            if (message.type === 'worker-idle') {
                if (state.exited || state.state === 'retiring')
                    return;
                state.currentJob = undefined;
                state.finishedEventSeen = false;
                state.teardownStarted = false;
                state.timedOutAt = 0;
                state.workerTermination = undefined;
                state.state = 'idle';
                this.releaseIdleWorker(state);
                return;
            }
            if (message.type === 'worker-retire') {
                this.handleWorkerRetire(state, message, handleEvent);
                return;
            }
            const event = message;
            event.workerSlot = state.slot;
            if (event.type === 'phase-started' && event.phase === 'teardown') {
                state.teardownStarted = true;
            }
            if (event.type === 'test-timeout') {
                state.timedOutAt = state.timedOutAt || Date.now();
                state.timeout = event.timeout;
                this.timedOutWorkers.set(state.id, state);
                this.resolveJob(state);
            }
            if (event.type === 'test-finished') {
                state.finishedEventSeen = true;
                if (event.timeout) {
                    state.timedOutAt = state.timedOutAt || Date.now();
                    state.timeout = event.timeout;
                    this.timedOutWorkers.set(state.id, state);
                }
                this.resolveJob(state);
            }
            if (event.type === 'worker-terminated') {
                state.workerTermination = event.workerTermination;
            }
            handleEvent(event);
        });
        worker.on('error', (err) => {
            const test = state.currentJob?.test;
            if (test && !state.currentJob?.logicalResolved && !state.finishedEventSeen) {
                handleEvent(this.buildWorkerFailureEvent(test, state.id, state.slot, err, state.workerTermination, test.source.hasTeardown ? 'not-run' : 'not-needed'));
            }
            this.resolveJob(state);
            state.finishedEventSeen = true;
            this.replaceWorker(state, handleEvent);
        });
        worker.on('exit', (code) => {
            const priorState = state.state;
            state.exited = true;
            state.state = 'exited';
            state.resolveExit();
            resolveReady();
            this.removeIdleWorker(state);
            this.timedOutWorkers.delete(state.id);
            const test = state.currentJob?.test;
            if (test && state.timedOutAt && !state.finishedEventSeen) {
                handleEvent(this.buildTimedOutFailureEvent(state, state.workerTermination));
                state.finishedEventSeen = true;
            }
            else if (test && code !== 0 && !state.finishedEventSeen && !state.currentJob?.logicalResolved) {
                handleEvent(this.buildWorkerFailureEvent(test, state.id, state.slot, new Error(`Worker exited with code ${code}.`), state.workerTermination, test.source.hasTeardown ? 'not-run' : 'not-needed'));
                state.finishedEventSeen = true;
            }
            this.resolveJob(state);
            if (!this.shuttingDown && !state.replacementSpawned && priorState !== 'idle') {
                void this.spawnWorker(handleEvent, state.slot);
                state.replacementSpawned = true;
            }
        });
        await readyPromise;
        return state;
    }
    handleWorkerRetire(state, message, handleEvent) {
        state.state = 'retiring';
        this.removeIdleWorker(state);
        if (!state.replacementSpawned && !this.shuttingDown) {
            void this.spawnWorker(handleEvent, state.slot);
            state.replacementSpawned = true;
        }
        if (message.reason === 'timeout') {
            state.timedOutAt = state.timedOutAt || Date.now();
            if (message.timeout)
                state.timeout = message.timeout;
            this.timedOutWorkers.set(state.id, state);
            return;
        }
        void state.worker.terminate();
    }
    async acquireIdleWorker() {
        const idle = this.idleWorkers.shift();
        if (idle)
            return idle;
        return await new Promise((resolve) => {
            this.idleWaiters.push(resolve);
        });
    }
    releaseIdleWorker(worker) {
        const waiter = this.idleWaiters.shift();
        if (waiter) {
            waiter(worker);
            return;
        }
        this.idleWorkers.push(worker);
    }
    removeIdleWorker(worker) {
        this.idleWorkers = this.idleWorkers.filter((candidate) => candidate.id !== worker.id);
    }
    dispatchTest(worker, test) {
        worker.state = 'busy';
        worker.finishedEventSeen = false;
        worker.teardownStarted = false;
        worker.timeout = {
            phase: 'run',
            timeoutMs: test.timeout,
        };
        return new Promise((resolve) => {
            worker.currentJob = {
                test,
                logicalResolved: false,
                resolve,
            };
            worker.worker.postMessage({
                type: 'run-test',
                test,
            });
        });
    }
    resolveJob(worker) {
        const job = worker.currentJob;
        if (!job || job.logicalResolved)
            return;
        job.logicalResolved = true;
        job.resolve();
    }
    replaceWorker(worker, handleEvent) {
        if (worker.replacementSpawned || this.shuttingDown)
            return;
        worker.replacementSpawned = true;
        void this.spawnWorker(handleEvent, worker.slot);
    }
}
//# sourceMappingURL=TestRunner.js.map