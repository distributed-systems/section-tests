import { Worker } from 'node:worker_threads';
import { CollectedTest, Reporter, SerializedError, TeardownStatus, TestEvent, TestRunSummary, TimeoutInfo, TimeoutPolicy, WorkerRetireMessage, WorkerTerminationInfo } from './runtime-types.js';
export declare const SECTION_TESTS_JSON_SUMMARY_PREFIX = "SECTION_TESTS_SUMMARY:";
interface TestRunnerOptions {
    patterns: string[];
    jsonSummary?: boolean;
    jobs?: number;
    reporters?: Reporter[];
    defaultTimeoutMs?: number;
    timeoutGraceMs?: number;
}
interface WorkerJobState {
    test: CollectedTest;
    logicalResolved: boolean;
    resolve: () => void;
}
interface TimedOutWorkerState {
    id: string;
    slot: number;
    worker: Worker;
    currentJob?: WorkerJobState;
    timedOutAt: number;
    timeout: TimeoutInfo;
    exitPromise: Promise<void>;
    resolveExit: () => void;
    exited: boolean;
    finishedEventSeen: boolean;
    teardownStarted: boolean;
    workerTermination?: WorkerTerminationInfo;
    replacementSpawned: boolean;
    state: 'starting' | 'idle' | 'busy' | 'retiring' | 'exited';
}
export default class TestRunner {
    patterns: string[];
    files?: string[];
    jsonSummary: boolean;
    jobs: number;
    reporters: Reporter[];
    timeoutPolicy: TimeoutPolicy;
    timedOutWorkers: Map<string, TimedOutWorkerState>;
    idleWorkers: TimedOutWorkerState[];
    idleWaiters: Array<(worker: TimedOutWorkerState) => void>;
    workerSeq: number;
    shuttingDown: boolean;
    constructor({ patterns, jsonSummary, jobs, reporters, defaultTimeoutMs, timeoutGraceMs, }: TestRunnerOptions);
    execute(): Promise<void>;
    emitJsonSummary(summary: TestRunSummary): void;
    resolvePatterns(): Promise<void>;
    executeQueue(tests: CollectedTest[], maxWorkers: number, handleEvent: (event: TestEvent) => void): Promise<void>;
    drainTimedOutWorkers(handleEvent: (event: TestEvent) => void): Promise<void>;
    buildTimedOutFailureEvent(state: TimedOutWorkerState, workerTermination?: WorkerTerminationInfo): TestEvent;
    getInterruptedTeardownStatus(state: TimedOutWorkerState): TeardownStatus;
    buildWorkerFailureEvent(test: CollectedTest, workerId: string, workerSlot: number, err: unknown, workerTermination: WorkerTerminationInfo | undefined, teardownStatus: TeardownStatus): TestEvent;
    serializeError(err: unknown): SerializedError;
    initializePool(handleEvent: (event: TestEvent) => void, workerSlots: number): Promise<void>;
    spawnWorker(handleEvent: (event: TestEvent) => void, slot: number): Promise<TimedOutWorkerState>;
    handleWorkerRetire(state: TimedOutWorkerState, message: WorkerRetireMessage, handleEvent: (event: TestEvent) => void): void;
    acquireIdleWorker(): Promise<TimedOutWorkerState>;
    releaseIdleWorker(worker: TimedOutWorkerState): void;
    removeIdleWorker(worker: TimedOutWorkerState): void;
    dispatchTest(worker: TimedOutWorkerState, test: CollectedTest): Promise<void>;
    resolveJob(worker: TimedOutWorkerState): void;
    replaceWorker(worker: TimedOutWorkerState, handleEvent: (event: TestEvent) => void): void;
}
export {};
//# sourceMappingURL=TestRunner.d.ts.map