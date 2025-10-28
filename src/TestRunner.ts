import section from '../index.js';
import glob from '@distributed-systems/glob';
import { exec } from 'child_process';
import TestSuiteEndMessage from './message/TestSuiteEndMessage.js';

interface TestRunnerOptions {
    patterns: string[];
}

export default class TestRunner {
    patterns: string[];
    files?: string[];

    constructor({patterns}: TestRunnerOptions) {
        this.patterns = patterns;
    }

    /**
     * runs the test suite
     *
     * @return     {Promise} 
     */
    async execute(): Promise<void> {
        const start = Date.now();

        await this.resolvePatterns();
        await this.loadFiles();
        const { ok, failed } = await section.execute();

        const message = new TestSuiteEndMessage({
            duration: Date.now() - start,
            ok,
            failed,
            section: (section as any).section || section,
        });

        // tell that we're finished
        const transports = section.getTransports();
        transports.forEach((transport) => transport.send(message));
    }

    /**
     * resolve the user provided patterns using the glob library
     *
     * @return     {Promise}  
     */
    async resolvePatterns(): Promise<void> {
        this.files = await glob(process.cwd(), ...this.patterns);
    }

    /**
     * since node provides just shitty unusable info for syntax errors we need
     * to hack a bit: start node as child process using the file that fails. the
     * output will give us the missing info. thanks for nothing.
     *
     * @param      {string}   file    path to the failing file
     * @return     {Promise}  object containing usable error information
     */
    analyzeSyntaxError(file: string, err: Error): Promise<string | undefined> {
        return new Promise((resolve) => {
            exec(`${process.argv[0]} ${process.execArgv.join(' ')} ${file}`, (err, stdout, stderr) => {
                if (stderr.startsWith('file:///')) {
                    resolve(stderr.replace(/\\n/g, '\n'));
                }

                resolve(undefined);
            });
        });
    }

    /**
     * load all test files, they will register their tests by their own
     *
     * @return     {Promise}
     */
    async loadFiles(): Promise<void> {
        if (!this.files) return;

        for (const file of this.files) {
            try {
                await import(file);
            } catch (err: any) {
                let syntaxErrorMessage: string | undefined;
                
                if (err.name === 'SyntaxError') {

                    // got a nasty syntax error, we need to execute this in a sub
                    // process in order to gather the required information
                    syntaxErrorMessage = await this.analyzeSyntaxError(file, err);
                }

                console.log(`Failed to load ${file}:`);
                
                if (syntaxErrorMessage) console.log(syntaxErrorMessage);
                else {
                    console.log(err.message);
                    
                    if (Array.isArray(err.stack)) err.stack.forEach((frame: any) => console.log(frame.toString()));
                    else console.log(err.stack);
                }

                process.exit(1);
            }                
        }
    }
}

