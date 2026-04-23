import TestSuiteEndMessage from './message/TestSuiteEndMessage.js';
export declare const SECTION_TESTS_JSON_SUMMARY_PREFIX = "SECTION_TESTS_SUMMARY:";
interface TestRunnerOptions {
    patterns: string[];
    jsonSummary?: boolean;
}
export default class TestRunner {
    patterns: string[];
    files?: string[];
    jsonSummary: boolean;
    constructor({ patterns, jsonSummary }: TestRunnerOptions);
    /**
     * runs the test suite
     *
     * @return     {Promise}
     */
    execute(): Promise<void>;
    emitJsonSummary(message: TestSuiteEndMessage): void;
    /**
     * resolve the user provided patterns using the glob library
     *
     * @return     {Promise}
     */
    resolvePatterns(): Promise<void>;
    /**
     * since node provides just shitty unusable info for syntax errors we need
     * to hack a bit: start node as child process using the file that fails. the
     * output will give us the missing info. thanks for nothing.
     *
     * @param      {string}   file    path to the failing file
     * @return     {Promise}  object containing usable error information
     */
    analyzeSyntaxError(file: string, err: Error): Promise<string | undefined>;
    /**
     * load all test files, they will register their tests by their own
     *
     * @return     {Promise}
     */
    loadFiles(): Promise<void>;
}
export {};
//# sourceMappingURL=TestRunner.d.ts.map