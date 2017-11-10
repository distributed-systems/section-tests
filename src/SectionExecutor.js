{
    'use strict';


    const log = require('ee-log');
    const SectionMessage = require('./message/SectionMessage');
    const TestErrorMessage = require('./message/TestErrorMessage');
    const TestSuccessMessage = require('./message/TestSuccessMessage');
    const TestStartMessage = require('./message/TestStartMessage');
    const SetupErrorMessage = require('./message/SetupErrorMessage');
    const SetupSuccessMessage = require('./message/SetupSuccessMessage');
    const SetupStartMessage = require('./message/SetupStartMessage');
    const DestroyerErrorMessage = require('./message/DestroyerErrorMessage');
    const DestroyerSuccessMessage = require('./message/DestroyerSuccessMessage');
    const DestroyerStartMessage = require('./message/DestroyerStartMessage');
    const LogMessage = require('./message/LogMessage');
    




    module.exports = class SectionExecutor {





        constructor({section}) {
            this.section = section;
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

            const data = {
                  stack: this.formatStackTrace(err)
                , message: err.message
                , type: isAssertion ? 'AssertionError' : err.name
            }

            if (isAssertion) {
                if (err.expected !== undefined) data.expected = err.expected;
                if (err.actual !== undefined) data.actual = err.actual;
                if (err.operator !== undefined) data.operator = err.operator;
            }

            return data;
        }








       
        formatStackTrace(err) {
            const frames = [];
            const stack = err.stack;


            if (typeof stack === 'string') return stack;
            else {
                stack.forEach((frame) => {
                    frames.push({
                          typeName: frame.getTypeName()
                        , functionName: frame.getFunctionName()
                        , methodName: frame.getMethodName()
                        , fileName: frame.getFileName()
                        , lineNumber: frame.getLineNumber()
                        , columnNumber: frame.getColumnNumber()
                        , isConstructor: frame.isConstructor()
                        , isNative: frame.isNative()
                        , isToplevel: frame.isToplevel()
                        , isEval: frame.isEval()
                    });
                });

                return frames;
            }
        }








        async executeSubSections() {
            for (const section of this.section.childSections.values()) {
                const subExecutor = new SectionExecutor({section});
                await subExecutor.execute();
            }
        }








        async executeTests() {
            const section = this.section;

            for (const test of section.tests.values()) {
                const start = Date.now();

                this.sendMessage(new TestStartMessage({start, test, section}));

                try {
                    section.sendLog = (message, level) => this.sendLogMessage({section, message, level});
                    await test.cb();
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
                    await destroyer.cb();
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
                    await setup.cb();
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
}