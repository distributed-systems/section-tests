import { Worker } from 'node:worker_threads';
import { CollectedTest, Reporter, SerializedError, TeardownStatus, TestEvent, TestRunSummary, TimeoutInfo, TimeoutPolicy, WorkerTerminationInfo } from './runtime-types.js';
export declare const SECTION_TESTS_JSON_SUMMARY_PREFIX = "SECTION_TESTS_SUMMARY:";
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
    constructor({ patterns, jsonSummary, jobs, reporters, defaultTimeoutMs, timeoutGraceMs, }: TestRunnerOptions);
    execute(): Promise<void>;
    emitJsonSummary(summary: TestRunSummary): void;
    resolvePatterns(): Promise<void>;
    executeQueue(tests: CollectedTest[], maxWorkers: number, handleEvent: (event: TestEvent) => void): Promise<void>;
    executeTest(test: CollectedTest, handleEvent: (event: TestEvent) => void): Promise<void>;
    drainTimedOutWorkers(handleEvent: (event: TestEvent) => void): Promise<void>;
    buildTimedOutFailureEvent(state: TimedOutWorkerState, workerTermination?: WorkerTerminationInfo): TestEvent;
    getInterruptedTeardownStatus(state: TimedOutWorkerState): TeardownStatus;
    buildWorkerFailureEvent(test: CollectedTest, err: unknown, workerTermination: WorkerTerminationInfo | undefined, teardownStatus: TeardownStatus): TestEvent;
    serializeError(err: unknown): SerializedError;
}
export {};
//# sourceMappingURL=TestRunner.d.ts.map