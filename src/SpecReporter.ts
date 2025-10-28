import chalk from './lib/chalk.js';
import { MessageType } from './types.js';
import type Message from './message/Message.js';
import type ErrorMessage from './message/ErrorMessage.js';
import type LogMessage from './message/LogMessage.js';
import type TestStartMessage from './message/TestStartMessage.js';
import type TestSuccessMessage from './message/TestSuccessMessage.js';
import type TestErrorMessage from './message/TestErrorMessage.js';
import type SetupStartMessage from './message/SetupStartMessage.js';
import type SetupSuccessMessage from './message/SetupSuccessMessage.js';
import type SetupErrorMessage from './message/SetupErrorMessage.js';
import type DestroyerStartMessage from './message/DestroyerStartMessage.js';
import type DestroyerSuccessMessage from './message/DestroyerSuccessMessage.js';
import type DestroyerErrorMessage from './message/DestroyerErrorMessage.js';
import type TestSuiteEndMessage from './message/TestSuiteEndMessage.js';
import type SectionMessage from './message/SectionMessage.js';

const colorMap = new Map<string, string>();

colorMap.set('error', 'red'); 
colorMap.set('warn', 'yellow'); 
colorMap.set('success', 'green'); 
colorMap.set('info', 'white'); 
colorMap.set('notice', 'dim'); 

export default class SpecReporter {
    failedStacks: MessageType[][];
    currentSectionTree: SectionMessage[];
    cachedMessages: MessageType[];
    lastStartMessage?: MessageType | null;
    padAmount: number;
    lastType?: string;

    constructor() {
        this.failedStacks = [];
        this.currentSectionTree = [];
        this.cachedMessages = [];
        this.padAmount = 0;
    }

    send(message: MessageType): void {
        message.padAmount = 4 * message.depth - 2;
        this.processMessage(message);
    }

    getCurrentSectionTree(): SectionMessage[] {
        let i = this.currentSectionTree.length - 2;
        const startSection = this.currentSectionTree[this.currentSectionTree.length - 1];
        let lastDepth = startSection.depth;
        const sectionTree: SectionMessage[] = [startSection];

        while(i >= 0) {
            const currentSection = this.currentSectionTree[i];

            const currentDepth = currentSection.depth;
            if (currentDepth < lastDepth) {
                sectionTree.push(currentSection);
                lastDepth = currentDepth;
            }
            i--;
            if (currentDepth === 0) break;
        }

        return sectionTree.reverse();
    }

    processMessage(message: MessageType): void {
        switch (message.type) {
            case 'sectionMessage': 
                this.currentSectionTree.push(message as SectionMessage);
                return this.displayMessage(message);

            case 'testErrorMessage':
            case 'setupErrorMessage':
            case 'destroyerErrorMessage':
                const currentDisplayStack = this.cachedMessages;
                currentDisplayStack.push(message);
                this.displayMessages(currentDisplayStack);

                const messages = [...this.getCurrentSectionTree(), ...currentDisplayStack];
                this.cachedMessages = [];

                this.failedStacks.push(messages);
                break;

            case 'testSuccessMessage': return this.displayMessage(message);
            case 'setupSuccessMessage': return this.displayMessage(message);
            case 'destroyerSuccessMessage': return this.displayMessage(message);

            case 'testSuiteEndMessage': return this.displayMessage(message);

            case 'logMessage':
                if (this.lastStartMessage) {
                    this.cachedMessages.push(this.lastStartMessage);
                    this.lastStartMessage = null;
                }

                this.cachedMessages.push(message);
                return;

            case 'destroyerStartMessage':
            case 'setupStartMessage':
            case 'testStartMessage':
                this.lastStartMessage = message;
                return;
        }
    }

    displayMessages(messages: MessageType[]): void {
        for (const message of messages) {
            this.displayMessage(message);
        }
    }

    displayCachedMessages(): void {
        for (const message of this.cachedMessages) {
            this.displayMessage(message);
        }

        this.cachedMessages = [];
    }

    displayMessage(message: MessageType): void {
        this.padAmount = message.padAmount || 0;

        switch (message.type) {
            case 'destroyerErrorMessage': 
                this.displayDestroyerErrorMessage(message as DestroyerErrorMessage);
                break;
            case 'destroyerStartMessage': 
                this.displayDestroyerStartMessage(message as DestroyerStartMessage);
                break;
            case 'destroyerSuccessMessage': 
                this.displayDestroyerSuccessMessage(message as DestroyerSuccessMessage);
                break;
            case 'logMessage': 
                this.displayLogMessage(message as LogMessage);
                break;
            case 'sectionMessage': 
                this.displaySectionMessage(message as SectionMessage);
                break;
            case 'setupErrorMessage': 
                this.displaySetupErrorMessage(message as SetupErrorMessage);
                break;
            case 'setupStartMessage': 
                this.displaySetupStartMessage(message as SetupStartMessage);
                break;
            case 'setupSuccessMessage': 
                this.displaySetupSuccessMessage(message as SetupSuccessMessage);
                break;
            case 'testErrorMessage': 
                this.displayTestErrorMessage(message as TestErrorMessage);
                break;
            case 'testStartMessage': 
                this.displayTestStartMessage(message as TestStartMessage);
                break;
            case 'testSuccessMessage': 
                this.displayTestSuccessMessage(message as TestSuccessMessage);
                break;
            case 'testSuiteEndMessage': 
                this.displayTestSuiteEndMessage(message as TestSuiteEndMessage);
                break;
        }

        this.lastType = message.type;
    }

    displayTestSuiteEndMessage(message: TestSuiteEndMessage): void {
        this.padAmount = 0;

        // display all fails
        if (this.failedStacks.length) {
            console.log(`\n\n${this.pad(2)}${chalk.yellow('======================== Failed Tests ======================')}`);

            for (const stack of this.failedStacks) {
                this.displayMessages(stack);
            }

            this.padAmount = 0;
            console.log(`\n\n${this.pad(2)}${chalk.yellow(`${message.failed} / ${message.ok + message.failed} tests failed!`)}\n\n`);
        } else {
            console.log(`\n\n${this.pad(2)}${chalk.green.bold(`${message.ok + message.failed} tests executed successfully 😊`)}\n\n`);
        }
    }

    displayLogMessage(message: LogMessage): void {
        const color = colorMap.get(message.level) || 'white';
        const prefix = (chalk as any)[color](`➟  ${message.level}:`);
        console.log(`${this.pad(8)}${prefix} ${chalk.white(message.message)}`);
    }

    displaySetupStartMessage(message: SetupStartMessage): void {
        console.log(`${this.pad(4)}${chalk.dim('⬇ ')}${chalk.grey(message.name)}`);
    }

    displaySetupErrorMessage(message: SetupErrorMessage): void {
        console.log(`${this.pad(4)}${chalk.red('✖ ')}${chalk.yellow(`${message.name}:`)} ${chalk.white(message.err.message)}\n`);
        message.err.stack.forEach((frame: any) => {
            console.log(`${this.pad(8)}${chalk.dim(`at ${frame.name} (${frame.source}:${frame.line})`)}`);
        });
    }

    displaySetupSuccessMessage(message: SetupSuccessMessage): void {
        this.displayCachedMessages();
        console.log(`${this.pad(4)}${chalk.dim.green('✔ ')}${chalk.grey(message.name)}${this.getDurationMark(message)}`);
    }

    displayTestStartMessage(message: TestStartMessage): void {
        console.log(`${this.pad(4)}${chalk.dim('⬇ ')}${chalk.white(message.test.name)}`);
    }

    displayTestSuccessMessage(message: TestSuccessMessage): void {
        this.displayCachedMessages();
        console.log(`${this.pad(4)}${chalk.green('✔ ')}${chalk.white(message.test!.name)}${this.getDurationMark(message)}`);
    }

    displayTestErrorMessage(message: TestErrorMessage): void {
        console.log(`${this.pad(4)}${chalk.red('✖ ')}${chalk.yellow(message.test!.name+':')} ${chalk.white(message.err.message)}\n`);

        if (typeof message.err.stack === 'string') {
            const data = /at (?<functionName>.*) \(file:\/\/(?<fileName>.*.js):(?<lineNumber>\d+)/i.exec(message.err.stack);
            if (data?.groups) {
                console.log(`${this.pad(8)}${chalk.dim(`at ${data.groups.functionName} (${data.groups.fileName}:${data.groups.lineNumber})`)}`);
            }
        } else {
            console.log(`${this.pad(8)}${chalk.dim(`at ${message.err.stack[0].name || '<unknown>'} (${message.err.stack[0].source}:${message.err.stack[0].line})`)}`);
        }

        if (message.err.type === 'AssertionError' && message.err.actual !== undefined && message.err.expected !== undefined) {
            console.log(`\n${this.pad(8)}${chalk.red('actual: ')}    ${chalk.white(message.err.actual)}`);
            console.log(`${this.pad(8)}${chalk.dim('operator: ')}  ${chalk.dim(message.err.operator || '')}`);
            console.log(`${this.pad(8)}${chalk.green('expected: ')}  ${chalk.white(message.err.expected)}\n`);
        } else {
            // display the friggin stack
            if (typeof message.err.stack === 'string') console.log(message.err.stack);
            else {
                message.err.stack.slice(1).forEach((frame: any) => {
                    console.log(`${this.pad(8)}${chalk.dim(`at ${frame.name} (${frame.source}:${frame.line})`)}`);
                });
            }
        }
    }

    getDurationMark(message: Message): string {
        if (message.duration && Number.isInteger(message.duration)) {
            if (message.duration > 500) return chalk.dim(` (${chalk.yellow.bold(message.duration.toString())} msec)`);
        }

        return '';
    }

    displayDestroyerStartMessage(message: DestroyerStartMessage): void {
        console.log(`${this.pad(4)}${chalk.dim('⬇ ')}${chalk.grey(message.name)}`);
    }

    displayDestroyerErrorMessage(message: DestroyerErrorMessage): void {
        console.log(`${this.pad(4)}${chalk.red('✖ ')}${chalk.yellow(`${message.name}:`)} ${chalk.white(message.err.message)}\n`);
        message.err.stack.forEach((frame: any) => {
            console.log(`${this.pad(8)}${chalk.dim(`at ${frame.name} (${frame.source}:${frame.line})`)}`);
        });
    }

    displayDestroyerSuccessMessage(message: DestroyerSuccessMessage): void {
        this.displayCachedMessages();
        console.log(`${this.pad(4)}${chalk.dim.green('✔ ')}${chalk.grey(message.name)}${this.getDurationMark(message)}`);
    }

    displaySectionMessage(message: SectionMessage): void {
        if (message.sectionName !== 'root' || message.depth !== 0) {
            console.log(`${this.lastType === 'sectionMessage' ? '' : '\n'}${this.pad()}${chalk.blue.bold(message.sectionName)}`);
        } else {
            //console.log(`  ${chalk.blue.bold('Executing Tests')}`);
        }
    }

    pad(add: number = 0): string {
        return ' '.repeat(this.padAmount + add);
    }
}

