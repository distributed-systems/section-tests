#!/usr/bin/env node
import TestRunner from '../src/TestRunner.js';
// handle unhandled rejections
process.on('unhandledRejection', (err, p) => {
    // another hack because node is crappy with syntax errors. see
    // TestRunner.analyzeSyntaxError. It needs to execute node to get to the
    // error message. but it will also cause an unhandled rejection. no matter
    // what.
    if (err.message.startsWith('Unexpected token'))
        return;
    else
        console.trace(err);
});
process.on('uncaughtException', console.trace);
let patterns = process.argv.slice(2).filter(s => s && s[0] !== '-');
// executes as binary, run tests
new TestRunner({
    patterns,
}).execute();
//# sourceMappingURL=run.js.map