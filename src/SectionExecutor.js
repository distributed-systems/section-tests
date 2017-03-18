{
    'use strict';


    const log = require('ee-log');
    const SectionMessage = require('./message/SectionMessage');
    const TestErrorMessage = require('./message/TestErrorMessage');
    const TestSuccessMessage = require('./message/TestSuccessMessage');
    const SetupErrorMessage = require('./message/SetupErrorMessage');
    const SetupSuccessMessage = require('./message/SetupSuccessMessage');
    const DestroyerErrorMessage = require('./message/DestroyerErrorMessage');
    const DestroyerSuccessMessage = require('./message/DestroyerSuccessMessage');
    




    module.exports = class SectionExecutor {





        constructor({section}) {
            this.section = section;
        }






        async execute() {

            // send the section message
            const section = this.section;
            const message = new SectionMessage({section});
            this.sendMessage(message);


            await this.executeSetups();
            await this.executeTests();
            await this.executeSubSections();
            await this.executeDestroyers();
        }









        /**
        * converts an error object to a transportabel standard error
        *
        * @param {error} err
        *
        * @returns {object}
        */
        convertError(err) {
            const data = {
                  stack: this.formatStackTrace(err)
                , message: err.message
                , type: err.name
            }

            if (err.name === 'AssertionError') {
                if (err.expected) data.expected = err.expected;
                if (err.actual) data.actual = err.actual;
                if (err.operator) data.operator = err.operator;
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


                try {
                    await test.cb();
                } catch (e) {

                    // send the error message
                    const err = this.convertError(e);
                    const duration = Date.now() - start;
                    const errorMessage = new TestErrorMessage({err, test, section, duration});
                    this.sendMessage(errorMessage);

                    // skipt to next test
                    continue;
                }


                // send succes message
                const duration = Date.now() - start;
                const successMessage = new TestSuccessMessage({test, section, duration});
                this.sendMessage(successMessage);
            }
        }







        async executeDestroyers() {
            const section = this.section;

            for (const destroyer of section.destroyers.values()) {
                try {
                    await destroyer.cb();
                } catch (e) {

                    // send the error message
                    const err = this.convertError(e);
                    const errorMessage = new DestroyerErrorMessage({err, destroyer, section});
                    this.sendMessage(errorMessage);

                    // skipt to next destroyer
                    continue;
                }


                // send succes message
                const successMessage = new DestroyerSuccessMessage({destroyer, section});
                this.sendMessage(successMessage);
            }
        }







        async executeSetups() {
            const section = this.section;

            for (const setup of section.setups.values()) {
                try {
                    await setup.cb();
                } catch (e) {

                    // send the error message
                    const err = this.convertError(e);
                    const errorMessage = new SetupErrorMessage({err, setup, section});
                    this.sendMessage(errorMessage);

                    // skipt to next setup
                    continue;
                }


                // send succes message
                const successMessage = new SetupSuccessMessage({setup, section});
                this.sendMessage(successMessage);
            }
        }






        sendMessage(message) {
            const transports = this.section.getTransports();
            transports.forEach((transport) => transport.send(message));
        }
    }
}