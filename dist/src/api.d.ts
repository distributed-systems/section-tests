import { SuiteDefinition, TestDefinition, TestDefinitionOptions, TestEntry, TestRunWithoutSetup } from './runtime-types.js';
export declare const DEFAULT_TEST_TIMEOUT = 2000;
export declare function test(name: string, run: TestRunWithoutSetup): TestDefinition;
export declare function test<TSetup = unknown>(name: string, options: TestDefinitionOptions<TSetup>): TestDefinition<TSetup>;
export declare function suite(name: string, ...entries: TestEntry[]): SuiteDefinition;
export declare function serial(name: string, run: TestRunWithoutSetup): TestDefinition;
export declare function serial<TSetup = unknown>(name: string, options: TestDefinitionOptions<TSetup>): TestDefinition<TSetup>;
export declare function defineTests(...entries: TestEntry[]): TestEntry[];
//# sourceMappingURL=api.d.ts.map