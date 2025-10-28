export interface SectionInterface {
    (name: string, fn: (section: SectionInterface) => void): void;
    (fn: (section: SectionInterface) => void): void;
    (name: string, options: SectionOptions, fn: (section: SectionInterface) => void): void;
    (options: SectionOptions, fn: (section: SectionInterface) => void): void;
    test: TestFunction;
    setup: SetupFunction;
    destroy: DestroyFunction;
    execute: () => Promise<ExecutionResult>;
    getDepth: () => number;
    getTransports: () => Transport[];
    use: (transport: Transport) => void;
    continue: ContinueSectionFunction;
    setTimeout: (msec: number) => void;
    wait: (msecs: number) => Promise<void>;
    warn: (message: string) => void;
    error: (message: string) => void;
    success: (message: string) => void;
    info: (message: string) => void;
    notice: (message: string) => void;
}
export interface SectionOptions {
    [key: string]: any;
}
export interface TestFunction {
    (name: string, fn: () => void | Promise<void>): void;
    (fn: () => void | Promise<void>): void;
    (name: string, options: TestOptions, fn: () => void | Promise<void>): void;
    (options: TestOptions, fn: () => void | Promise<void>): void;
}
export interface SetupFunction {
    (name: string, fn: () => void | Promise<void>): void;
    (fn: () => void | Promise<void>): void;
}
export interface DestroyFunction {
    (name: string, fn: () => void | Promise<void>): void;
    (fn: () => void | Promise<void>): void;
}
export interface ContinueSectionFunction {
    (name: string, fn: (section: SectionInterface) => void): void;
    (fn: (section: SectionInterface) => void): void;
    (name: string, options: SectionOptions, fn: (section: SectionInterface) => void): void;
    (options: SectionOptions, fn: (section: SectionInterface) => void): void;
}
export interface TestOptions {
    [key: string]: any;
}
export interface Test {
    name: string;
    executeTest: () => void | Promise<void>;
    options: TestOptions;
}
export interface Setup {
    name: string;
    executeSetup: () => void | Promise<void>;
}
export interface Destroyer {
    name: string;
    executeDestroy: () => void | Promise<void>;
}
export interface Transport {
    send: (message: MessageType) => void;
}
export interface ExecutionResult {
    ok: number;
    failed: number;
}
export interface ErrorData {
    stack: any[];
    message: string;
    type: string;
    expected?: any;
    actual?: any;
    operator?: string;
}
export type MessageType = Message | ErrorMessage | SuccessMessage | LogMessage | SectionMessage | TestStartMessage | TestSuccessMessage | TestErrorMessage | SetupStartMessage | SetupSuccessMessage | SetupErrorMessage | DestroyerStartMessage | DestroyerSuccessMessage | DestroyerErrorMessage | TestSuiteEndMessage;
export interface Message {
    sectionName: string;
    depth: number;
    type: string;
    duration?: number;
    padAmount?: number;
}
export interface ErrorMessage extends Message {
    err: ErrorData;
    test?: Test;
}
export interface SuccessMessage extends Message {
    test?: Test;
}
export interface LogMessage extends Message {
    message: string;
    level: string;
}
export interface SectionMessage extends Message {
}
export interface TestStartMessage extends Message {
    test: Test;
}
export interface TestSuccessMessage extends SuccessMessage {
    test: Test;
}
export interface TestErrorMessage extends ErrorMessage {
    test: Test;
}
export interface SetupStartMessage extends Message {
    name: string;
}
export interface SetupSuccessMessage extends SuccessMessage {
    name: string;
}
export interface SetupErrorMessage extends ErrorMessage {
    name: string;
}
export interface DestroyerStartMessage extends Message {
    name: string;
}
export interface DestroyerSuccessMessage extends SuccessMessage {
    name: string;
}
export interface DestroyerErrorMessage extends ErrorMessage {
    name: string;
}
export interface TestSuiteEndMessage extends Message {
    failed: number;
    ok: number;
}
//# sourceMappingURL=types.d.ts.map