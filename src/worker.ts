import process from 'node:process';
import { parentPort, workerData } from 'node:worker_threads';
import { collectEntriesFromFile, resolveCollectedTestFromEntries } from './collection.js';
import {
    CollectedTest,
    LogLevel,
    SerializedError,
    TeardownStatus,
    TestContext,
    TestDefinition,
    TestEntry,
    TestEvent,
    TestFinishedEvent,
    TestPhase,
    TimeoutInfo,
    WorkerBootstrapData,
    WorkerCommand,
    WorkerLifecycleMessage,
    WorkerMessage,
    WorkerRetireReason,
} from './runtime-types.js';

function requireParentPort() {
    if (!parentPort) {
        throw new Error('section-tests worker requires a parent port.');
    }

    return parentPort;
}

function serializeError(err: unknown): SerializedError {
    if (err instanceof Error) {
        return {
            name: err.name,
            message: err.message,
            stack: err.stack,
        };
    }

    if (typeof err === 'string') {
        return {
            name: 'Error',
            message: err,
        };
    }

    return {
        name: 'Error',
        message: 'Unknown worker error',
    };
}

function serializeTimeoutFailure(timeout: TimeoutInfo): SerializedError {
    return {
        name: 'TimeoutError',
        message: `The ${timeout.phase} phase timed out after ${timeout.timeoutMs} milliseconds.`,
    };
}

class PhaseTimeoutError extends Error {
    timeout: TimeoutInfo;

    constructor(timeout: TimeoutInfo) {
        super(`The ${timeout.phase} phase timed out after ${timeout.timeoutMs} milliseconds.`);
        this.name = 'TimeoutError';
        this.timeout = timeout;
    }
}

async function runWithTimeout<T>(
    execute: () => Promise<T>,
    timeout: TimeoutInfo,
    onTimeout: (timeout: TimeoutInfo) => void,
): Promise<T> {
    return await new Promise<T>((resolve, reject) => {
        const timer = setTimeout(() => {
            onTimeout(timeout);
            reject(new PhaseTimeoutError(timeout));
        }, timeout.timeoutMs);

        execute().then((value) => {
            clearTimeout(timer);
            resolve(value);
        }).catch((err) => {
            clearTimeout(timer);
            reject(err);
        });
    });
}

const runPhaseTimeBudgetExceeded = Object.freeze({ reason: 'run-phase-time-budget' as const });

/** After a run timeout, wait for the in-flight run promise; return `stuck` if it is still not settled. */
function waitForRunToSettleOrStuck(
    runTask: Promise<unknown>,
    quiesceMs: number,
): Promise<'settled' | 'stuck'> {
    if (quiesceMs <= 0) {
        return Promise.resolve('stuck');
    }
    return new Promise((resolve) => {
        let done = false;
        const onDeadline = setTimeout(() => {
            if (!done) {
                done = true;
                resolve('stuck');
            }
        }, quiesceMs);
        runTask.finally(() => {
            if (done) return;
            done = true;
            clearTimeout(onDeadline);
            resolve('settled');
        });
    });
}

interface FileCacheEntry {
    entries: TestEntry[];
    definitions: Map<string, TestDefinition>;
}

interface ExecutionState {
    test: CollectedTest;
    markUnexpectedFailure: (err: unknown) => void;
}

const port = requireParentPort();
const { workerId } = workerData as WorkerBootstrapData;
const fileCache = new Map<string, FileCacheEntry>();
let busy = false;
let retiring = false;
let shuttingDown = false;
let currentExecution: ExecutionState | null = null;

function emit(message: WorkerMessage): void {
    port.postMessage(message);
}

function emitLifecycle(message: WorkerLifecycleMessage): void {
    emit(message);
}

function emitRetire(reason: WorkerRetireReason, test?: CollectedTest, timeout?: TimeoutInfo): void {
    if (retiring) return;
    retiring = true;
    emitLifecycle({
        type: 'worker-retire',
        workerId,
        reason,
        testId: test?.id,
        timeout,
    });
}

async function getDefinition(test: CollectedTest): Promise<{ definition: TestDefinition; prepareDurationMs: number }> {
    const startedAt = Date.now();
    let cache = fileCache.get(test.file);
    if (!cache) {
        cache = {
            entries: await collectEntriesFromFile(test.file),
            definitions: new Map(),
        };
        fileCache.set(test.file, cache);
    }

    let definition = cache.definitions.get(test.id);
    if (!definition) {
        definition = resolveCollectedTestFromEntries(cache.entries, test);
        cache.definitions.set(test.id, definition);
    }

    return {
        definition,
        prepareDurationMs: Date.now() - startedAt,
    };
}

function handleUnexpectedFailure(err: unknown): void {
    if (currentExecution) {
        currentExecution.markUnexpectedFailure(err);
        return;
    }

    emitRetire('unexpected-error');
}

process.on('unhandledRejection', handleUnexpectedFailure);
process.on('uncaughtException', handleUnexpectedFailure);

async function executeTest(test: CollectedTest): Promise<void> {
    busy = true;

    let prepareDurationMs = 0;

    // Emit `test-started` BEFORE the (potentially slow) file import / definition lookup so the
    // reporter can immediately show the new test on this slot. Otherwise the slot keeps showing the
    // previously finished (green ✔) test until `getDefinition` resolves, which under parallel load
    // makes all 16 slots appear to swap in unison once their imports complete.
    emit({
        type: 'test-started',
        workerId,
        testId: test.id,
        file: test.file,
        suitePath: test.suitePath,
        testName: test.name,
        mode: test.mode,
    });

    try {
        const resolved = await getDefinition(test);
        const definition = resolved.definition;
        prepareDurationMs = resolved.prepareDurationMs;
        const controller = new AbortController();

        const emitEvent = (event: TestEvent) => {
            emit(event);
        };

        const context: TestContext = {
            file: test.file,
            testName: test.name,
            suitePath: test.suitePath,
            signal: controller.signal,
            info: (message: string) => emitLog('info', message),
            warn: (message: string) => emitLog('warn', message),
            error: (message: string) => emitLog('error', message),
            success: (message: string) => emitLog('success', message),
            notice: (message: string) => emitLog('notice', message),
            log: (level: LogLevel, message: string) => emitLog(level, message),
        };

        function emitLog(level: LogLevel, message: string): void {
            emitEvent({
                type: 'test-log',
                workerId,
                testId: test.id,
                file: test.file,
                suitePath: test.suitePath,
                testName: test.name,
                level,
                message,
            });
        }

        const startedAt = Date.now();
        let setupResult: unknown;
        let setupCompleted = false;
        let teardownStatus: TeardownStatus = definition.teardown ? 'not-run' : 'not-needed';
        let failure: SerializedError | undefined;
        let failurePhase: TestPhase | 'worker' | undefined;
        let timeout: TimeoutInfo | undefined;
        let retireReason: WorkerRetireReason | undefined;
        let runStuckAfterQuiesce = false;

        currentExecution = {
            test,
            markUnexpectedFailure: (err: unknown) => {
                if (!failure) {
                    failure = serializeError(err);
                    failurePhase = 'worker';
                }
                retireReason = 'unexpected-error';
                controller.abort();
            },
        };

        const emitTimeout = (phase: TestPhase) => {
            const timeoutInfo: TimeoutInfo = {
                phase,
                timeoutMs: test.timeout,
            };

            controller.abort();

            if (!timeout) timeout = timeoutInfo;
            retireReason = 'timeout';

            emitEvent({
                type: 'test-timeout',
                workerId,
                testId: test.id,
                file: test.file,
                suitePath: test.suitePath,
                testName: test.name,
                timeout: timeoutInfo,
            });

            return timeoutInfo;
        };

        try {
            if (definition.setup) {
                emitEvent({
                    type: 'phase-started',
                    workerId,
                    phase: 'setup',
                    testId: test.id,
                    file: test.file,
                    suitePath: test.suitePath,
                    testName: test.name,
                });

                setupResult = await runWithTimeout(
                    () => Promise.resolve(definition.setup!(context)),
                    {
                        phase: 'setup',
                        timeoutMs: test.timeout,
                    },
                    () => {
                        emitTimeout('setup');
                    },
                );
                setupCompleted = true;

                emitEvent({
                    type: 'phase-finished',
                    workerId,
                    phase: 'setup',
                    testId: test.id,
                    file: test.file,
                    suitePath: test.suitePath,
                    testName: test.name,
                });
            }

            emitEvent({
                type: 'phase-started',
                workerId,
                phase: 'run',
                testId: test.id,
                file: test.file,
                suitePath: test.suitePath,
                testName: test.name,
            });

            const runTask = (async () => {
                if (definition.setup) await (definition.run as any)(setupResult, context);
                else await (definition.run as any)(context);
            })();

            const runPhaseOutcome = await Promise.race([
                runTask.then(() => 'ok' as const),
                new Promise<typeof runPhaseTimeBudgetExceeded>((resolve) => {
                    setTimeout(() => resolve(runPhaseTimeBudgetExceeded), test.timeout);
                }),
            ]);

            if (runPhaseOutcome === runPhaseTimeBudgetExceeded) {
                emitTimeout('run');
                if (!failure) {
                    const runTimeoutInfo: TimeoutInfo = { phase: 'run', timeoutMs: test.timeout };
                    failure = serializeTimeoutFailure(runTimeoutInfo);
                    failurePhase = 'run';
                }
                const quiesceMs = test.timeout * 2;
                if (quiesceMs > 0) {
                    const settledOrStuck = await waitForRunToSettleOrStuck(runTask, quiesceMs);
                    if (settledOrStuck === 'stuck') {
                        runStuckAfterQuiesce = true;
                    }
                } else {
                    runStuckAfterQuiesce = true;
                }
            } else {
                await runTask;
                emitEvent({
                    type: 'phase-finished',
                    workerId,
                    phase: 'run',
                    testId: test.id,
                    file: test.file,
                    suitePath: test.suitePath,
                    testName: test.name,
                });
            }
        } catch (err) {
            if (!failure) {
                if (err instanceof PhaseTimeoutError) {
                    failure = serializeTimeoutFailure(err.timeout);
                    failurePhase = err.timeout.phase;
                } else {
                    failure = serializeError(err);
                    if (!failurePhase) {
                        failurePhase = !definition.setup ? 'run' : (setupCompleted ? 'run' : 'setup');
                    }
                }
            }
        } finally {
            try {
                // After a `run` timeout we wait up to `2 * test.timeout` for the run promise to
                // settle. If it is still pending, teardown is unsafe; skip it and let the parent
                // retire/kill the worker. Otherwise teardown runs.
                if (runStuckAfterQuiesce && definition.teardown) {
                    teardownStatus = 'skipped';
                } else if (definition.teardown && (!definition.setup || setupCompleted)) {
                    emitEvent({
                        type: 'phase-started',
                        workerId,
                        phase: 'teardown',
                        testId: test.id,
                        file: test.file,
                        suitePath: test.suitePath,
                        testName: test.name,
                    });

                    await runWithTimeout(
                        () => Promise.resolve(
                            definition.setup
                                ? definition.teardown!(setupResult as never, context)
                                : (definition.teardown as any)(context),
                        ),
                        {
                            phase: 'teardown',
                            timeoutMs: test.timeout,
                        },
                        () => {
                            teardownStatus = 'timed-out';
                            emitTimeout('teardown');
                        },
                    );
                    teardownStatus = 'completed';

                    emitEvent({
                        type: 'phase-finished',
                        workerId,
                        phase: 'teardown',
                        testId: test.id,
                        file: test.file,
                        suitePath: test.suitePath,
                        testName: test.name,
                    });
                }
            } catch (err) {
                retireReason = retireReason || 'teardown-failed';

                if (err instanceof PhaseTimeoutError) {
                    teardownStatus = 'timed-out';

                    if (!failure) {
                        failure = serializeTimeoutFailure(err.timeout);
                        failurePhase = 'teardown';
                    }
                } else {
                    teardownStatus = 'failed';

                    if (!failure) {
                        failure = serializeError(err);
                        failurePhase = 'teardown';
                    }
                }
            }

            controller.abort();
            currentExecution = null;

            if (failurePhase === 'worker') {
                retireReason = retireReason || 'unexpected-error';
            }

            const finishedEvent: TestFinishedEvent = {
                type: 'test-finished',
                workerId,
                testId: test.id,
                file: test.file,
                suitePath: test.suitePath,
                testName: test.name,
                status: failure ? 'failed' : 'passed',
                durationMs: Date.now() - startedAt,
                prepareDurationMs,
                failure,
                failurePhase,
                timeout,
                teardownStatus,
            };

            emitEvent(finishedEvent);

            if (retireReason) {
                emitRetire(retireReason, test, timeout);
            }
        }
    } catch (err) {
        const finishedEvent: TestFinishedEvent = {
            type: 'test-finished',
            workerId,
            testId: test.id,
            file: test.file,
            suitePath: test.suitePath,
            testName: test.name,
            status: 'failed',
            durationMs: 0,
            prepareDurationMs,
            failure: serializeError(err),
            failurePhase: 'worker',
            teardownStatus: 'interrupted',
        };

        emit(finishedEvent);
    } finally {
        busy = false;

        if (shuttingDown) {
            process.exit(0);
            return;
        }

        if (!retiring) {
            emitLifecycle({
                type: 'worker-idle',
                workerId,
            });
        }
    }
}

port.on('message', (message: WorkerCommand) => {
    if (message.type === 'shutdown') {
        shuttingDown = true;
        if (!busy) process.exit(0);
        return;
    }

    if (retiring || busy) {
        emitRetire('protocol-violation', message.test);
        return;
    }

    void executeTest(message.test);
});

emitLifecycle({
    type: 'worker-ready',
    workerId,
});
