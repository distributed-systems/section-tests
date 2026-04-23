export type TestMode = 'parallel' | 'serial';
export type LogLevel = 'info' | 'warn' | 'error' | 'success' | 'notice';
export type TestPhase = 'setup' | 'run' | 'teardown';
export type TeardownStatus = 'not-needed' | 'not-run' | 'completed' | 'failed' | 'timed-out' | 'interrupted';
export type WorkerRetireReason = 'timeout' | 'teardown-failed' | 'unexpected-error' | 'protocol-violation' | 'hygiene';

export interface TestContext {
    file: string;
    testName: string;
    suitePath: string[];
    signal: AbortSignal;
    info: (message: string) => void;
    warn: (message: string) => void;
    error: (message: string) => void;
    success: (message: string) => void;
    notice: (message: string) => void;
    log: (level: LogLevel, message: string) => void;
}

export type TestRunWithoutSetup = (context: TestContext) => void | Promise<void>;
export type TestSetup<TSetup = unknown> = (context: TestContext) => TSetup | Promise<TSetup>;
export type TestRunWithSetup<TSetup = unknown> = (setupResult: TSetup, context: TestContext) => void | Promise<void>;
export type TestTeardownWithoutSetup = (context: TestContext) => void | Promise<void>;
export type TestTeardown<TSetup = unknown> =
    | ((setupResult: TSetup, context: TestContext) => void | Promise<void>)
    | TestTeardownWithoutSetup;

export interface TestDefinition<TSetup = unknown> {
    kind: 'test';
    name: string;
    mode: TestMode;
    timeout?: number;
    setup?: TestSetup<TSetup>;
    run: TestRunWithoutSetup | TestRunWithSetup<TSetup>;
    teardown?: TestTeardown<TSetup>;
}

export interface SuiteDefinition {
    kind: 'suite';
    name: string;
    entries: TestEntry[];
}

export type TestEntry = TestDefinition<any> | SuiteDefinition | TestEntry[];

export interface TestDefinitionOptions<TSetup = unknown> {
    setup?: TestSetup<TSetup>;
    run: TestRunWithoutSetup | TestRunWithSetup<TSetup>;
    teardown?: TestTeardown<TSetup>;
    mode?: TestMode;
    timeout?: number;
}

export interface TimeoutPolicy {
    defaultTimeoutMs: number;
    timeoutGraceMs: number;
}

export interface CollectedTest {
    id: string;
    file: string;
    name: string;
    suitePath: string[];
    mode: TestMode;
    timeout: number;
    entryPath: number[];
    source: {
        hasSetup: boolean;
        hasTeardown: boolean;
    };
}

export interface TestPlan {
    files: string[];
    tests: CollectedTest[];
}

export interface SerializedError {
    name: string;
    message: string;
    stack?: string;
}

export interface TimeoutInfo {
    phase: TestPhase;
    timeoutMs: number;
}

export interface WorkerTerminationInfo {
    forced: boolean;
    reason: 'timeout-grace-expired';
    graceMs: number;
}

export interface TestEventBase {
    testId: string;
    file: string;
    suitePath: string[];
    testName: string;
}

export interface TestStartedEvent extends TestEventBase {
    type: 'test-started';
    mode: TestMode;
}

export interface TestPhaseEvent extends TestEventBase {
    type: 'phase-started' | 'phase-finished';
    phase: TestPhase;
}

export interface TestLogEvent extends TestEventBase {
    type: 'test-log';
    level: LogLevel;
    message: string;
}

export interface TestTimeoutEvent extends TestEventBase {
    type: 'test-timeout';
    timeout: TimeoutInfo;
}

export interface WorkerTerminatedEvent extends TestEventBase {
    type: 'worker-terminated';
    workerTermination: WorkerTerminationInfo;
}

export interface TestFinishedEvent extends TestEventBase {
    type: 'test-finished';
    status: 'passed' | 'failed';
    durationMs: number;
    prepareDurationMs: number;
    failure?: SerializedError;
    failurePhase?: TestPhase | 'worker';
    timeout?: TimeoutInfo;
    teardownStatus: TeardownStatus;
    workerTermination?: WorkerTerminationInfo;
}

export type TestEvent =
    | TestStartedEvent
    | TestPhaseEvent
    | TestLogEvent
    | TestTimeoutEvent
    | WorkerTerminatedEvent
    | TestFinishedEvent;

export interface TestExecutionRecord {
    test: CollectedTest;
    events: TestEvent[];
    status?: 'passed' | 'failed';
    durationMs?: number;
    prepareDurationMs?: number;
    failure?: SerializedError;
    failurePhase?: TestPhase | 'worker';
    timeout?: TimeoutInfo;
    teardownStatus?: TeardownStatus;
    workerTermination?: WorkerTerminationInfo;
}

export interface Reporter {
    onPlan?: (plan: TestPlan) => void;
    onEvent: (event: TestEvent) => void;
    onSummary?: (summary: TestRunSummary) => void;
    flush?: () => void;
}

export interface TestRunSummary {
    ok: number;
    failed: number;
    total: number;
    durationMs: number;
    pass: boolean;
    records: TestExecutionRecord[];
}

export interface WorkerRunTestCommand {
    type: 'run-test';
    test: CollectedTest;
}

export interface WorkerShutdownCommand {
    type: 'shutdown';
}

export type WorkerCommand = WorkerRunTestCommand | WorkerShutdownCommand;

export interface WorkerBootstrapData {
    workerId: string;
}

export interface WorkerLifecycleMessageBase {
    workerId: string;
}

export interface WorkerReadyMessage extends WorkerLifecycleMessageBase {
    type: 'worker-ready';
}

export interface WorkerIdleMessage extends WorkerLifecycleMessageBase {
    type: 'worker-idle';
}

export interface WorkerRetireMessage extends WorkerLifecycleMessageBase {
    type: 'worker-retire';
    reason: WorkerRetireReason;
    testId?: string;
    timeout?: TimeoutInfo;
}

export type WorkerLifecycleMessage = WorkerReadyMessage | WorkerIdleMessage | WorkerRetireMessage;
export type WorkerMessage = TestEvent | WorkerLifecycleMessage;
