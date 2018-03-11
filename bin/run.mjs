#!/usr/bin/env node
'use strict';

import TestRunner from '../src/TestRunner';
import path from 'path';
import log from 'ee-log';



// handle unhandleed rejections
process.on('unhandledRejection', (reason, p) => {
    console.log(reason);
});


process.on('uncaughtException', (err) => {
    console.log(err.message);
    err.stack.forEach(frame => console.log(frame.toString()));
});




let files = process.argv.slice(2).filter(s => s && s[0] !== '-');

files = files.map((file) => {
    if (file[0] === '.') {
        return path.join(process.env.PWD, file)
    } return file;
});



// executes as binary, run tests
new TestRunner({
    patterns: files
}).execute();