import process from 'node:process';
import { parentPort, workerData } from 'node:worker_threads';
import { resolveCollectedTest } from './collection.js';
import {
    CollectedTest,
    LogLevel,
    SerializedError,
    TeardownStatus,
    TestContext,
    TestEvent,
    TestPhase,
    TimeoutInfo,
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

async function main(): Promise<void> {
    const port = requireParentPort();
    const collectedTest = workerData as CollectedTest;
    const definition = await resolveCollectedTest(collectedTest);
    const controller = new AbortController();

    const emit = (event: TestEvent) => {
        port.postMessage(event);
    };

    const context: TestContext = {
        file: collectedTest.file,
        testName: collectedTest.name,
        suitePath: collectedTest.suitePath,
        signal: controller.signal,
        info: (message: string) => emitLog('info', message),
        warn: (message: string) => emitLog('warn', message),
        error: (message: string) => emitLog('error', message),
        success: (message: string) => emitLog('success', message),
        notice: (message: string) => emitLog('notice', message),
        log: (level: LogLevel, message: string) => emitLog(level, message),
    };

    function emitLog(level: LogLevel, message: string): void {
        emit({
            type: 'test-log',
            testId: collectedTest.id,
            file: collectedTest.file,
            suitePath: collectedTest.suitePath,
            testName: collectedTest.name,
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

    const emitTimeout = (phase: TestPhase) => {
        const timeoutInfo: TimeoutInfo = {
            phase,
            timeoutMs: collectedTest.timeout,
        };

        controller.abort();

        if (!timeout) timeout = timeoutInfo;

        emit({
            type: 'test-timeout',
            testId: collectedTest.id,
            file: collectedTest.file,
            suitePath: collectedTest.suitePath,
            testName: collectedTest.name,
            timeout: timeoutInfo,
        });

        return timeoutInfo;
    };

    emit({
        type: 'test-started',
        testId: collectedTest.id,
        file: collectedTest.file,
        suitePath: collectedTest.suitePath,
        testName: collectedTest.name,
        mode: collectedTest.mode,
    });

    const handleUnexpectedFailure = (err: unknown) => {
        failure = serializeError(err);
        failurePhase = 'worker';
    };

    process.once('unhandledRejection', handleUnexpectedFailure);
    process.once('uncaughtException', handleUnexpectedFailure);

    try {
        if (definition.setup) {
            emit({
                type: 'phase-started',
                phase: 'setup',
                testId: collectedTest.id,
                file: collectedTest.file,
                suitePath: collectedTest.suitePath,
                testName: collectedTest.name,
            });

            setupResult = await runWithTimeout(
                () => Promise.resolve(definition.setup!(context)),
                {
                    phase: 'setup',
                    timeoutMs: collectedTest.timeout,
                },
                () => {
                    emitTimeout('setup');
                },
            );
            setupCompleted = true;

            emit({
                type: 'phase-finished',
                phase: 'setup',
                testId: collectedTest.id,
                file: collectedTest.file,
                suitePath: collectedTest.suitePath,
                testName: collectedTest.name,
            });
        }

        emit({
            type: 'phase-started',
            phase: 'run',
            testId: collectedTest.id,
            file: collectedTest.file,
            suitePath: collectedTest.suitePath,
            testName: collectedTest.name,
        });

        await runWithTimeout(
            async () => {
                if (definition.setup) await (definition.run as any)(setupResult, context);
                else await (definition.run as any)(context);
            },
            {
                phase: 'run',
                timeoutMs: collectedTest.timeout,
            },
            () => {
                emitTimeout('run');
            },
        );

        emit({
            type: 'phase-finished',
            phase: 'run',
            testId: collectedTest.id,
            file: collectedTest.file,
            suitePath: collectedTest.suitePath,
            testName: collectedTest.name,
        });
    } catch (err) {
        if (!failure) {
            if (err instanceof PhaseTimeoutError) {
                failure = serializeTimeoutFailure(err.timeout);
                failurePhase = err.timeout.phase;
            } else {
                failure = serializeError(err);
                failurePhase = failurePhase || (setupCompleted ? 'run' : 'setup');
            }
        }
    } finally {
        try {
            if (definition.teardown && (!definition.setup || setupCompleted)) {
                emit({
                    type: 'phase-started',
                    phase: 'teardown',
                    testId: collectedTest.id,
                    file: collectedTest.file,
                    suitePath: collectedTest.suitePath,
                    testName: collectedTest.name,
                });

                await runWithTimeout(
                    () => Promise.resolve(
                        definition.setup
                            ? definition.teardown!(setupResult as never, context)
                            : (definition.teardown as any)(context),
                    ),
                    {
                        phase: 'teardown',
                        timeoutMs: collectedTest.timeout,
                    },
                    () => {
                        teardownStatus = 'timed-out';
                        emitTimeout('teardown');
                    },
                );
                teardownStatus = 'completed';

                emit({
                    type: 'phase-finished',
                    phase: 'teardown',
                    testId: collectedTest.id,
                    file: collectedTest.file,
                    suitePath: collectedTest.suitePath,
                    testName: collectedTest.name,
                });
            }
        } catch (err) {
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
        process.removeListener('unhandledRejection', handleUnexpectedFailure);
        process.removeListener('uncaughtException', handleUnexpectedFailure);

        emit({
            type: 'test-finished',
            testId: collectedTest.id,
            file: collectedTest.file,
            suitePath: collectedTest.suitePath,
            testName: collectedTest.name,
            status: failure ? 'failed' : 'passed',
            durationMs: Date.now() - startedAt,
            failure,
            failurePhase,
            timeout,
            teardownStatus,
        });
    }
}

main().catch((err) => {
    const port = requireParentPort();
    const collectedTest = workerData as CollectedTest;

    port.postMessage({
        type: 'test-finished',
        testId: collectedTest.id,
        file: collectedTest.file,
        suitePath: collectedTest.suitePath,
        testName: collectedTest.name,
        status: 'failed',
        durationMs: 0,
        failure: serializeError(err),
        failurePhase: 'worker',
        teardownStatus: 'interrupted',
    });
});
