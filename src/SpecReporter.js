{
    'use strict';


    const log = require('ee-log');
    const chalk = require('chalk');





    module.exports = class SpecReporter {




        send(message) {
            //log(message, '✔'.green);
            this.padAmount = 4 * message.depth - 2;
            this.displayMessage(message);

            this.lastType = message.type;
        }






        displayMessage(message) {
            switch (message.type) {
                case 'sectionMessage': return this.displaySectionMessage(message);
                case 'testErrorMessage': return this.displayTestErrorMessage(message);
                case 'testSuccessMessage': return this.displayTestSuccessMessage(message);
            }
        }





        displayTestErrorMessage(message) {
            console.log(`${this.pad(4)}${chalk.red('✖ ')}${chalk.yellow(message.test.name+':')} ${chalk.white(message.err.message)}\n`);
            console.log(`${this.pad(8)}${chalk.dim(`at ${message.err.stack[0].functionName} (${message.err.stack[0].fileName}:${message.err.stack[0].lineNumber})`)}`);

            if (message.err.type === 'AssertionError' && message.err.actual !== undefined && message.err.expected !== undefined) {
                console.log(`\n${this.pad(8)}${chalk.green('expected: ')}  ${chalk.white(message.err.expected)}`);
                console.log(`${this.pad(8)}${chalk.red('actual: ')}    ${chalk.white(message.err.actual)}`);
                console.log(`${this.pad(8)}${chalk.dim('operator: ')}  ${chalk.dim(message.err.operator)}\n`);
            }
        }





        displayTestSuccessMessage(message) {
            console.log(`${this.pad(4)}${chalk.green('✔ ')}${chalk.white(message.test.name)}`);
        }






        displaySectionMessage(message) {
            if (message.sectionName !== 'root' || message.depth !== 0) {
                console.log(`${this.lastType === 'sectionMessage' ? '' : '\n'}${this.pad()}${chalk.blue.bold(message.sectionName)}`);
            }
        }






        pad(add = 0) {
            return ' '.repeat(this.padAmount+add);
        }
    }
}