import type from '@distributed-systems/types';
import assert from 'assert';
import SectionExecutor from './SectionExecutor.js';
import {
    SectionInterface,
    SectionOptions,
    Test,
    Setup,
    Destroyer,
    Transport,
    ExecutionResult,
    TestOptions,
    TestChainable,
} from './types.js';

interface SectionConstructorOptions {
    parent?: Section;
    name?: string;
    options?: SectionOptions;
}

class Section {
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

    constructor({parent, name = 'root', options = {}}: SectionConstructorOptions = {}) {
        if (parent) this.parent = parent;
        this.name = name;
        this.options = options;

        // the global timeout time
        if (this.isRootSection()) this.timeoutTime = 2000;

        // store 
        this.childSections = new Map();
        this.tests = new Set();
        this.setups = new Set();
        this.destroyers = new Set();
        this.transports = new Set();
        this.transportTypes = new Set();
    }

    /**
    * the user may set a custom timeout time
    */
    setTimeout(msec: number): void {
        assert(type.number(msec), `The timeout time must be a number!`);
        this.timeoutTime = msec;
    }

    /** 
    * returns the current timeout time
    */
    getTimeoutTime(): number {
        return this.timeoutTime || (!this.isRootSection() && this.parent!.getTimeoutTime()) || 2000;
    }

    /**
    * remove the custom timeout time
    */
    resetTimeoutTime(): void {
        this.timeoutTime = null;
    }

    getDepth(depth: number = 0): number {
        if (this.isRootSection()) return depth;
        else return this.parent!.getDepth(depth + 1);
    }

    getTransports(): Transport[] {
        return this.collectTransports();
    }   

    warn(message: string): void {
        this.log(message, 'warn');
    }

    error(message: string): void {
        this.log(message, 'error');
    }

    success(message: string): void {
        this.log(message, 'success');
    }

    info(message: string): void {
        this.log(message, 'info');
    }

    notice(message: string): void {
        this.log(message, 'notice');
    }

    log(message: string, level: string = 'info'): void {
        if (this.sendLog) this.sendLog(message, level);
        else throw new Error('Cannot log message outside of a test, setup or destroyer routine!');
    }

    collectTransports(transports: Transport[] = []): Transport[] {
        transports.push(...this.transports.values());

        if (this.isRootSection()) return transports;
        else return this.getRoot().collectTransports(transports);
    }

    getInterface(): SectionInterface {
        // return a function that can be invoked by the user
        const iface = this.continueSection.bind(this) as SectionInterface;

        // expose some methods
        iface.test = this.test.bind(this) as any;
        iface.setup = this.setup.bind(this) as any;
        iface.destroy = this.destroy.bind(this) as any;
        iface.execute = this.execute.bind(this);
        iface.getDepth = this.getDepth.bind(this);
        iface.getTransports = this.getTransports.bind(this);
        iface.use = this.use.bind(this);
        iface.continue = this.continueSection.bind(this) as any;

        iface.warn = this.warn.bind(this);
        iface.error = this.error.bind(this);
        iface.success = this.success.bind(this);
        iface.info = this.info.bind(this);
        iface.notice = this.notice.bind(this);

        // let the user define timeouts
        iface.setTimeout = this.setTimeout.bind(this);

        // tools
        iface.wait = this.wait.bind(this);

        return iface;
    }

    /**
    * wait some time
    */
    wait(msecs: number): Promise<void> {
        return new Promise((resolve) => {
            setTimeout(resolve, msecs);
        });
    }

    async execute(): Promise<ExecutionResult> {
        const section = this;
        const executor = new SectionExecutor({section});
        return await executor.execute();
    }

    use(transport: Transport): void {
        const transportType = (transport as any)?.constructor || transport;

        if (this.transportTypes.has(transportType)) {
            console.warn('Reporter type already registered, skipping duplicate registration.');
            return;
        }

        this.transportTypes.add(transportType);
        this.transports.add(transport);
    }

    test(...params: any[]): TestChainable {
        let options: TestOptions = {};
        let executeTest: () => void | Promise<void>;
        let name = 'anonymous';

        params.forEach((param, index) => {
            if (type.object(param)) options = param;
            else if (type.function(param)) executeTest = param;
            else if (type.string(param)) name = param;
            else throw new Error(`Invalid option at position ${index}!`);
        });

        const test: Test = {name, executeTest: executeTest!, options};
        this.tests.add(test);

        // Return chainable object with only() method
        return {
            only: () => {
                test.only = true;
            }
        };
    }

    setup(...params: any[]): void {
        let executeSetup: () => void | Promise<void>;
        let name = 'Setting Up';

        params.forEach((param, index) => {
            if (type.function(param)) executeSetup = param;
            else if (type.string(param)) name = param;
            else throw new Error(`Invalid option at position ${index}!`);
        });

        this.setups.add({name, executeSetup: executeSetup!});
    }

    destroy(...params: any[]): void {
        let executeDestroy: () => void | Promise<void>;
        let name = 'Destroying';

        params.forEach((param, index) => {
            if (type.function(param)) executeDestroy = param;
            else if (type.string(param)) name = param;
            else throw new Error(`Invalid option at position ${index}!`);
        });

        this.destroyers.add({name, executeDestroy: executeDestroy!});
    }

    getRoot(): Section {
        return this.isRootSection() ? this : this.parent!.getRoot();
    }

    isRootSection(): boolean {
        return !this.parent;
    }

    continueSection(...params: any[]): void {
        let options: SectionOptions = {};
        let executeSection: (iface: SectionInterface) => void;
        let name = 'anonymous';

        params.forEach((param, index) => {
            if (type.object(param)) options = param;
            else if (type.function(param)) executeSection = param;
            else if (type.string(param)) name = param;
            else throw new Error(`Invalid option at position ${index}!`);
        });

        if (!this.childSections.has(name)) {
            const parent = this;
            const instance = new Section({name, parent, options});
            this.childSections.set(name, [instance]);
        }

        executeSection!(this.childSections.get(name)![0].getInterface());
    }

    createSection(...params: any[]): void {
        let options: SectionOptions = {};
        let executeSection: (iface: SectionInterface) => void;
        let name = 'anonymous';

        params.forEach((param, index) => {
            if (type.object(param)) options = param;
            else if (type.function(param)) executeSection = param;
            else if (type.string(param)) name = param;
            else throw new Error(`Invalid option at position ${index}!`);
        });

        const parent = this;
        const instance = new Section({name, parent, options});

        if (!this.childSections.has(name)) this.childSections.set(name, []);
        this.childSections.get(name)!.push(instance);

        executeSection!(instance.getInterface());
    }
}

export default Section;

