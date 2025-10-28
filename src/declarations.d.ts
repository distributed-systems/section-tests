// Type declarations for external modules without TypeScript definitions

declare module '@distributed-systems/types' {
    const type: {
        number(value: any): boolean;
        object(value: any): boolean;
        function(value: any): boolean;
        string(value: any): boolean;
        promise(value: any): boolean;
    };
    export default type;
}

declare module '@distributed-systems/callsite' {
    export default class Callsite {
        getStack(options: { err: Error }): any[];
    }
}

declare module '@distributed-systems/glob' {
    export default function glob(cwd: string, ...patterns: string[]): Promise<string[]>;
}

declare module 'ee-log' {
    const log: (...args: any[]) => void;
    export default log;
}

