import section from'../index.js';
import glob from '../es-modules/distributed-systems/glob/2.0.0+/src/glob.js';
import { exec } from 'child_process';
import path from 'path';



export default class TestRunner {



    constructor({
        patterns
    }) {
        this.patterns = patterns;
    }




    /**
     * runs the test suite
     *
     * @return     {Promise} 
     */
    async execute() {
        await this.resolvePatterns();
        await this.loadFiles();
        await section.execute();
    }





    /**
     * resolve the user provided patterns using the glob library
     *
     * @return     {Promise}  
     */
    async resolvePatterns() {
        this.files = await glob(process.cwd(), ...this.patterns);
    }





    /**
     * since node provides jsut shitty unusable info for syntax errors we need
     * to hack a bit: start node as child process using the file that fails. the
     * output will give us the missing info. thanks for nothing.
     *
     * @param      {string}   file    path to the failing file
     * @return     {Promise}  object containing usable error information
     */
    analyzeSyntaxError(file, err) {
        return new Promise((resolve) => {
            exec(`${process.argv[0]} ${process.execArgv.join(' ')} ${file}`, (err, stdout, stderr) => {
                if (stderr.startsWith('file:///')) {
                    resolve(stderr.replace(/\\n/g, '\n'));
                }

                resolve();
            });
        });
    }





    /**
     * load all test files, they will register their tests by their own
     *
     * @return     {Promise}
     */
    async loadFiles() {
        for (const file of this.files) {
            try {
                await import(file);
            } catch (err) {
                let syntaxErrorMessage;
                
                if (err.name === 'SyntaxError') {

                    // got a nasty syntax error, we need to execute this in a sub
                    // process in order to gather the required information
                    syntaxErrorMessage = await this.analyzeSyntaxError(file, err);
                }

                console.log(`Failed to load ${file}:`);
                
                if (syntaxErrorMessage) console.log(syntaxErrorMessage);
                else {
                    console.log(err.message);
                    
                    if (Array.isArray(err.stack)) err.stack.forEach(frame => console.log(frame.toString()));
                    else console.log(err.stack);
                }

                process.exit(1);
            }                
        }
    }
}