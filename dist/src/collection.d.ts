import { CollectedTest, TestDefinition, TestEntry, TestPlan } from './runtime-types.js';
interface CollectTestPlanOptions {
    defaultTimeoutMs: number;
}
export declare function collectEntriesFromFile(file: string): Promise<TestEntry[]>;
export declare function collectTestPlan(files: string[], options: CollectTestPlanOptions): Promise<TestPlan>;
export declare function resolveCollectedTest(test: CollectedTest): Promise<TestDefinition>;
export declare function resolveCollectedTestFromEntries(entries: TestEntry[], test: CollectedTest): TestDefinition;
export {};
//# sourceMappingURL=collection.d.ts.map