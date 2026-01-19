import { SectionInterface, SectionOptions, Test, Setup, Destroyer, Transport, ExecutionResult, TestChainable } from './types.js';
interface SectionConstructorOptions {
    parent?: Section;
    name?: string;
    options?: SectionOptions;
}
declare class Section {
    parent?: Section;
    name: string;
    options: SectionOptions;
    timeoutTime?: number | null;
    childSections: Map<string, Section[]>;
    tests: Set<Test>;
    setups: Set<Setup>;
    destroyers: Set<Destroyer>;
    transports: Set<Transport>;
    transportTypes: Set<any>;
    sendLog?: ((message: string, level: string) => void) | null;
    constructor({ parent, name, options }?: SectionConstructorOptions);
    /**
    * the user may set a custom timeout time
    */
    setTimeout(msec: number): void;
    /**
    * returns the current timeout time
    */
    getTimeoutTime(): number;
    /**
    * remove the custom timeout time
    */
    resetTimeoutTime(): void;
    getDepth(depth?: number): number;
    getTransports(): Transport[];
    warn(message: string): void;
    error(message: string): void;
    success(message: string): void;
    info(message: string): void;
    notice(message: string): void;
    log(message: string, level?: string): void;
    collectTransports(transports?: Transport[]): Transport[];
    getInterface(): SectionInterface;
    /**
    * wait some time
    */
    wait(msecs: number): Promise<void>;
    execute(): Promise<ExecutionResult>;
    use(transport: Transport): void;
    test(...params: any[]): TestChainable;
    setup(...params: any[]): void;
    destroy(...params: any[]): void;
    getRoot(): Section;
    isRootSection(): boolean;
    continueSection(...params: any[]): void;
    createSection(...params: any[]): void;
}
export default Section;
//# sourceMappingURL=Section.d.ts.map