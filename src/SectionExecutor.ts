import type from '@distributed-systems/types';
import Callsite from '@distributed-systems/callsite';
import SectionMessage from './message/SectionMessage.js';
import TestErrorMessage from './message/TestErrorMessage.js';
import TestSuccessMessage from './message/TestSuccessMessage.js';
import TestStartMessage from './message/TestStartMessage.js';
import SetupErrorMessage from './message/SetupErrorMessage.js';
import SetupSuccessMessage from './message/SetupSuccessMessage.js';
import SetupStartMessage from './message/SetupStartMessage.js';
import DestroyerErrorMessage from './message/DestroyerErrorMessage.js';
import DestroyerSuccessMessage from './message/DestroyerSuccessMessage.js';
import DestroyerStartMessage from './message/DestroyerStartMessage.js';
import LogMessage from './message/LogMessage.js';
import type Section from './Section.js';
import { ExecutionResult, ErrorData, MessageType, Test } from './types.js';

interface SectionExecutorOptions {
    section: Section;
}

interface LogOptions {
    section: Section;
    message: string;
    level: string;
}

export default class SectionExecutor {
    section: Section;
    callsite: Callsite;

    constructor({section}: SectionExecutorOptions) {
        this.section = section;
        this.callsite = new Callsite();
    }

    normalizeProcessError(err: unknown): Error {
        if (err instanceof Error) return err;
        if (typeof err === 'string') return new Error(err);
        if (err && typeof err === 'object') {
            try {
                return new Error(JSON.stringify(err));
            } catch {
                return new Error('Unknown error');
            }
        }

        return new Error(String(err));
    }

    async runWithTimeout(execute: () => void | Promise<void>, timeoutTime: number, timeoutMessage: string): Promise<void> {
        let result: void | Promise<void>;

        try {
            result = execute();
        } catch (err) {
            throw err;
        }

        if (!type.promise(result)) return;

        let timeoutEncountered = false;
        await new Promise<void>((resolve, reject) => {
            const timeout = setTimeout(() => {
                timeoutEncountered = true;
                reject(new Error(timeoutMessage));
            }, timeoutTime);

            (result as Promise<void>).then(() => {
                clearTimeout(timeout);
                if (!timeoutEncountered) resolve();
            }).catch((err: any) => {
                clearTimeout(timeout);
                if (!timeoutEncountered) reject(err);
            });
        });
    }

    async runWithGuards(execute: () => void | Promise<void>, timeoutTime: number, timeoutMessage: string): Promise<void> {
        let finished = false;
        let rejectUnexpected: (err: Error) => void = () => undefined;

        const unexpectedError = new Promise<void>((_resolve, reject) => {
            rejectUnexpected = reject;
        });

        const handleUnhandledRejection = (reason: unknown) => {
            if (finished) return;
            rejectUnexpected(this.normalizeProcessError(reason));
        };

        const handleUncaughtException = (err: Error) => {
            if (finished) return;
            rejectUnexpected(this.normalizeProcessError(err));
        };

        process.once('unhandledRejection', handleUnhandledRejection);
        process.once('uncaughtException', handleUncaughtException);

        const runPromise = this.runWithTimeout(execute, timeoutTime, timeoutMessage);

        try {
            await Promise.race([runPromise, unexpectedError]);
        } finally {
            finished = true;
            process.removeListener('unhandledRejection', handleUnhandledRejection);
            process.removeListener('uncaughtException', handleUncaughtException);
            await runPromise.catch(() => undefined);
        }
    }

    async execute(): Promise<ExecutionResult> {
        const result: ExecutionResult = { ok: 0, failed: 0 };

        // send the section message
        const section = this.section;
        const message = new SectionMessage({section});
        this.sendMessage(message);

        const setupResult = await this.executeSetups();
        if (setupResult.error) process.exit(1);

        const results = await this.executeTests();
        const subResults = await this.executeSubSections();
        const destroyerFailed = await this.executeDestroyers();

        result.ok += (results.ok + subResults.ok);
        result.failed += (results.failed + subResults.failed + setupResult.failed + destroyerFailed);

        return result;
    }

    /**
    * converts an error object to a transportable standard error
    *
    * @param {error} err
    *
    * @returns {object}
    */
    convertError(err: any): ErrorData {
        err.returnStructured = true;
        const isAssertion = /AssertionError/gi.test(err.name);

        // get the stack from the callsite library,
        // it is able to get stacks without interfering
        // with other code
        const frames = this.callsite.getStack({
            err,
        });

        const data: ErrorData = {
            stack: frames,
            message: err.message,
            type: isAssertion ? 'AssertionError' : err.name,
        }

        if (isAssertion) {
            if (err.expected !== undefined) data.expected = err.expected;
            if (err.actual !== undefined) data.actual = err.actual;
            if (err.operator !== undefined) data.operator = err.operator;
        }

        return data;
    }

    async executeSubSections(): Promise<ExecutionResult> {
        const result: ExecutionResult = { ok: 0, failed: 0 };

        for (const sectionList of this.section.childSections.values()) {
            for (const section of sectionList) {
                const subExecutor = new SectionExecutor({section});
                const { ok, failed } = await subExecutor.execute();

                result.ok += ok;
                result.failed += failed;
            }
        }

        return result;
    }

    async executeTests(): Promise<ExecutionResult> {
        const result: ExecutionResult = { ok: 0, failed: 0 };
        const section = this.section;

        // Check if any tests are marked with .only()
        const testsArray = Array.from(section.tests.values());
        const onlyTests = testsArray.filter(test => test.only);
        const testsToExecute = onlyTests.length > 0 ? onlyTests : testsArray;

        for (const test of testsToExecute) {
            const start = Date.now();

            this.sendMessage(new TestStartMessage({start, test, section}));

            try {
                // collect log messages from the current 
                // section while the test is running
                section.sendLog = (message: string, level: string) => this.sendLogMessage({section, message, level});

                // run the test
                // make sure to not call the test as property of the test object.
                // that may generate weird stack traces
                const { executeTest } = test;

                const timeoutTime = section.getTimeoutTime();
                const timeoutMessage = `The test encountered a timeout after ${timeoutTime} milliseconds. Use section.setTimeout(msec) to increase the timeout time`;

                await this.runWithGuards(executeTest, timeoutTime, timeoutMessage);
            } catch (e) {
                
                // send the error message
                const err = this.convertError(e);
                const duration = Date.now() - start;
                const errorMessage = new TestErrorMessage({err, test, section, duration});
                this.sendMessage(errorMessage);

                result.failed++;

                // skip to next test
                continue;
            } finally {
                // reset the timeout for the next test
                section.resetTimeoutTime();

                // stop accepting log messages from the current test
                section.sendLog = null;
            }

            // send success message
            const duration = Date.now() - start;
            const successMessage = new TestSuccessMessage({test, section, duration});
            this.sendMessage(successMessage);

            result.ok++;
        }

        return result;
    }

    sendLogMessage(options: LogOptions): void {
        this.sendMessage(new LogMessage(options));
    }

    async executeDestroyers(): Promise<number> {
        const section = this.section;
        let failed = 0;

        for (const destroyer of section.destroyers.values()) {
            const start = Date.now();
            const name = destroyer.name;

            this.sendMessage(new DestroyerStartMessage({section, name}));

            try {
                section.sendLog = (message: string, level: string) => this.sendLogMessage({section, message, level});
                const timeoutTime = section.getTimeoutTime();
                const timeoutMessage = `The destroyer encountered a timeout after ${timeoutTime} milliseconds. Use section.setTimeout(msec) to increase the timeout time`;
                await this.runWithGuards(destroyer.executeDestroy, timeoutTime, timeoutMessage);
            } catch (e) {

                // send the error message
                const err = this.convertError(e);
                const duration = Date.now() - start;
                const errorMessage = new DestroyerErrorMessage({err, section, duration, name, test: undefined});
                this.sendMessage(errorMessage);

                failed++;

                // skip to next destroyer
                continue;
            } finally {
                section.resetTimeoutTime();
                section.sendLog = null;
            }

            // send success message
            const duration = Date.now() - start;
            const successMessage = new DestroyerSuccessMessage({section, duration, name, test: undefined});
            this.sendMessage(successMessage);
        }

        return failed;
    }

    async executeSetups(): Promise<{ error?: ErrorData; failed: number }> {
        const section = this.section;
        let failed = 0;

        for (const setup of section.setups.values()) {
            const start = Date.now();
            const name = setup.name;

            this.sendMessage(new SetupStartMessage({section, name}));

            try {
                section.sendLog = (message: string, level: string) => this.sendLogMessage({section, message, level});
                const timeoutTime = section.getTimeoutTime();
                const timeoutMessage = `The setup encountered a timeout after ${timeoutTime} milliseconds. Use section.setTimeout(msec) to increase the timeout time`;
                await this.runWithGuards(setup.executeSetup, timeoutTime, timeoutMessage);
            } catch (e) {

                // send the error message
                const err = this.convertError(e);
                const duration = Date.now() - start;
                const errorMessage = new SetupErrorMessage({err, section, duration, name, test: undefined});
                this.sendMessage(errorMessage);

                failed++;

                // skip to next setup
                return { error: err, failed };
            } finally {
                section.resetTimeoutTime();
                section.sendLog = null;
            }

            // send success message
            const duration = Date.now() - start;
            const successMessage = new SetupSuccessMessage({section, duration, name, test: undefined});
            this.sendMessage(successMessage);
        }

        return { failed };
    }

    sendMessage(message: MessageType): void {
        const transports = this.section.getTransports();
        transports.forEach((transport) => transport.send(message));
    }
}

