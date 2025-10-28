interface TestRunnerOptions {
    patterns: string[];
}
export default class TestRunner {
    patterns: string[];
    files?: string[];
    constructor({ patterns }: TestRunnerOptions);
    /**
     * runs the test suite
     *
     * @return     {Promise}
     */
    execute(): Promise<void>;
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