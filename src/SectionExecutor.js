import type from '../es-modules/distributed-systems/types/1.0.0+/types.js';
import Callsite from '../es-modules/distributed-systems/callsite/2.0.0+/Callsite.js';
import SectionMessage from './message/SectionMessage.js';
import TestErrorMessage from './message/TestErrorMessage.js';
import TestSuccessMessage from './message/TestSuccessMessage.js';
import TestStartMessage from './message/TestStartMessage.js';
import SetupErrorMessage from './message/SetupErrorMessage.js';
import SetupSuccessMessage from './message/SetupSuccessMessage.js';
import SetupStartMessage from './message/SetupStartMessage.js';
import DestroyerErrorMessage from './message/DestroyerErrorMessage.js';
import DestroyerSuccessMessage from './message/DestroyerSuccessMessage.js';
import DestroyerStartMessage from './message/DestroyerStartMessage.js';
import LogMessage from './message/LogMessage.js';





export default class SectionExecutor {





    constructor({section}) {
        this.section = section;
        this.callsite = new Callsite();
    }






    async execute() {

        // send the section message
        const section = this.section;
        const message = new SectionMessage({section});
        this.sendMessage(message);


        const err = await this.executeSetups();
        if (err) process.exit(1);

        await this.executeTests();
        await this.executeSubSections();
        await this.executeDestroyers();
    }









    /**
    * converts an error object to a transportable standard error
    *
    * @param {error} err
    *
    * @returns {object}
    */
    convertError(err) {
        err.returnStructured = true;
        const isAssertion = /AssertionError/gi.test(err.name);


        // get the stack from the callsite library,
        // it is able to get stacks without interfering
        // with other code
        const frames = this.callsite.getStack({
            err,
        });

        const data = {
            stack: frames,
            message: err.message,
            type: isAssertion ? 'AssertionError' : err.name,
        }


        if (isAssertion) {
            if (err.expected !== undefined) data.expected = err.expected;
            if (err.actual !== undefined) data.actual = err.actual;
            if (err.operator !== undefined) data.operator = err.operator;
        }

        return data;
    }









    async executeSubSections() {
        for (const sectionList of this.section.childSections.values()) {
            for (const section of sectionList) {
                const subExecutor = new SectionExecutor({section});
                await subExecutor.execute();
            }
        }
    }








    async executeTests() {
        const section = this.section;

        for (const test of section.tests.values()) {
            const start = Date.now();

            this.sendMessage(new TestStartMessage({start, test, section}));


            try {
                // collect log messages from the current 
                // section while the test is running
                section.sendLog = (message, level) => this.sendLogMessage({section, message, level});

                // run the test
                await new Promise((resolve, reject) => {
                    
                    // make sure to not call the test as property of the test object.
                    // that may generate weird stack traces
                    const { executeTest } = test;
                    const testPromise = executeTest();

                    if (!type.promise(testPromise)) resolve();
                    else {

                        // let tests time out
                        let timeoutEncountered = false;
                        const timeoutTime = section.getTimeoutTime();
                        const timeout = setTimeout(() => {
                            timeoutEncountered = true;
                            reject(new Error(`The test encountered a timeout after ${timeoutTime} milliseconds. Use section.setTimeout(msec) to increase the timeout time`));
                        }, timeoutTime);

                        // reset the timeout for the next test
                        section.resetTimeoutTime();

                        // run the actual test
                        testPromise.then(() => {
                            clearTimeout(timeout);
                            if (!timeoutEncountered) resolve();
                        }).catch((err) => {
                            clearTimeout(timeout);
                            if (!timeoutEncountered) reject(err);
                        });
                    }
                });

                // stop accepting log messages from the curren test
                section.sendLog = null;
            } catch (e) {
                
                // send the error message
                const err = this.convertError(e);
                const duration = Date.now() - start;
                const errorMessage = new TestErrorMessage({err, test, section, duration});
                this.sendMessage(errorMessage);

                // skip to next test
                continue;
            }


            // send success message
            const duration = Date.now() - start;
            const successMessage = new TestSuccessMessage({test, section, duration});
            this.sendMessage(successMessage);
        }
    }






    sendLogMessage(options) {
        this.sendMessage(new LogMessage(options));
    }






    async executeDestroyers() {
        const section = this.section;

        for (const destroyer of section.destroyers.values()) {
            const start = Date.now();
            const name = destroyer.name;

            this.sendMessage(new DestroyerStartMessage({section, name}));

            try {
                section.sendLog = (message, level) => this.sendLogMessage({section, message, level});
                await destroyer.executeDestroy();
                section.sendLog = null;
            } catch (e) {

                // send the error message
                const err = this.convertError(e);
                const duration = Date.now() - start;
                const errorMessage = new DestroyerErrorMessage({err, destroyer, section, duration, name});
                this.sendMessage(errorMessage);

                // skipt to next destroyer
                continue;
            }


            // send succes message
            const duration = Date.now() - start;
            const successMessage = new DestroyerSuccessMessage({destroyer, section, duration, name});
            this.sendMessage(successMessage);
        }
    }







    async executeSetups() {
        const section = this.section;

        for (const setup of section.setups.values()) {
            const start = Date.now();
            const name = setup.name;

            this.sendMessage(new SetupStartMessage({section, name}));

            try {
                section.sendLog = (message, level) => this.sendLogMessage({section, message, level});
                await setup.executeSetup();
                section.sendLog = null;
            } catch (e) {

                // send the error message
                const err = this.convertError(e);
                const duration = Date.now() - start;
                const errorMessage = new SetupErrorMessage({err, setup, section, duration, name});
                this.sendMessage(errorMessage);

                // skipt to next setup
                return err;
            }


            // send succes message
            const duration = Date.now() - start;
            const successMessage = new SetupSuccessMessage({setup, section, duration, name});
            this.sendMessage(successMessage);
        }
    }






    sendMessage(message) {
        const transports = this.section.getTransports();
        transports.forEach((transport) => transport.send(message));
    }
}