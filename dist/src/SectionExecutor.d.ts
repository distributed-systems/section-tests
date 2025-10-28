import Callsite from '@distributed-systems/callsite';
import type Section from './Section.js';
import { ExecutionResult, ErrorData, MessageType } from './types.js';
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
    constructor({ section }: SectionExecutorOptions);
    execute(): Promise<ExecutionResult>;
    /**
    * converts an error object to a transportable standard error
    *
    * @param {error} err
    *
    * @returns {object}
    */
    convertError(err: any): ErrorData;
    executeSubSections(): Promise<ExecutionResult>;
    executeTests(): Promise<ExecutionResult>;
    sendLogMessage(options: LogOptions): void;
    executeDestroyers(): Promise<void>;
    executeSetups(): Promise<ErrorData | undefined>;
    sendMessage(message: MessageType): void;
}
export {};
//# sourceMappingURL=SectionExecutor.d.ts.map