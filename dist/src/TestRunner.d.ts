import { Worker } from 'node:worker_threads';
import { CollectedTest, PreciseCoverageSnapshotJson, Reporter, SerializedError, TeardownStatus, TestEvent, TestRunSummary, TimeoutInfo, TimeoutPolicy, WorkerRetireMessage, WorkerTerminationInfo } from './runtime-types.js';
export declare const SECTION_TESTS_JSON_SUMMARY_PREFIX = "SECTION_TESTS_SUMMARY:";
export interface CoverageCliOptions {
    include: string[];
    exclude: string[];
    report: 'lcov' | 'none';
    min?: number;
}
interface TestRunnerOptions {
    patterns: string[];
    jsonSummary?: boolean;
    jobs?: number;
    reporters?: Reporter[];
    defaultTimeoutMs?: number;
    timeoutGraceMs?: number;
    /** Print buffered context / test-log output after the run. Off by default. */
    showTestLogs?: boolean;
    /** Plain chronological log for tooling / AI agents instead of the default TTY reporter. */
    agentOutput?: boolean;
    coverage?: CoverageCliOptions;
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
    /** V8 precise coverage from this worker (after cooperative shutdown). */
    coverageSnapshot?: PreciseCoverageSnapshotJson;
    coverageError?: string;
    coverageDeliveryTimedOut?: boolean;
    pendingCoverageResolve?: () => void;
    retirePendingShutdown?: boolean;
    coverageShutDownStarted?: boolean;
}
export default class TestRunner {
    patterns: string[];
    files?: string[];
    jsonSummary: boolean;
    showTestLogs: boolean;
    agentOutput: boolean;
    jobs: number;
    reporters: Reporter[];
    timeoutPolicy: TimeoutPolicy;
    timedOutWorkers: Map<string, TimedOutWorkerState>;
    idleWorkers: TimedOutWorkerState[];
    idleWaiters: Array<(worker: TimedOutWorkerState) => void>;
    workerSeq: number;
    shuttingDown: boolean;
    coverage?: CoverageCliOptions;
    /** Every spawned worker state for end-of-run shutdown (includes replaced workers until exit). */
    private workerRegistry;
    private coverageIncomplete;
    constructor({ patterns, jsonSummary, showTestLogs, agentOutput, jobs, reporters, defaultTimeoutMs, timeoutGraceMs, coverage, }: TestRunnerOptions);
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
    /**
     * Ask worker to send V8 coverage; wait up to `timeoutGraceMs` for `coverage-result`, then terminate.
     */
    requestCooperativeShutdown(state: TimedOutWorkerState): Promise<void>;
    /** After tests complete, collect coverage from every worker that is still alive. */
    shutdownIdleWorkersForCoverage(): Promise<void>;
    acquireIdleWorker(): Promise<TimedOutWorkerState>;
    releaseIdleWorker(worker: TimedOutWorkerState): void;
    removeIdleWorker(worker: TimedOutWorkerState): void;
    dispatchTest(worker: TimedOutWorkerState, test: CollectedTest): Promise<void>;
    resolveJob(worker: TimedOutWorkerState): void;
    replaceWorker(worker: TimedOutWorkerState, handleEvent: (event: TestEvent) => void): void;
}
export {};
//# sourceMappingURL=TestRunner.d.ts.map