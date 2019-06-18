'use strict';

import log from 'ee-log';
import glob from 'glob';
import section from'../index.mjs';


export default class TestRunner {


    constructor({patterns}) {
        this.patterns = patterns;
    }




    async execute() {
        const files = await this.getFiles();
        await this.loadFiles(files);
        await section.execute();
    }



    

    async loadFiles(files) {
        for (const file of files) {
            try {
                await import(file);
            } catch (err) {
                console.log(`Failed to load ${file}:`);
                console.log(err.message);
                
                if (Array.isArray(err.stack)) err.stack.forEach(frame => console.log(frame.toString()));
                else console.log(err.stack);

                process.exit(1);
            }                
        }
    }





    async getFiles() {
        return Promise.all(this.patterns.map((pattern) => {
            return new Promise((resolve, reject) => {
                glob.glob(pattern, (err, files) => {
                    if (err) reject(err);
                    else resolve(files);
                });
            });
        })).then((fileArrays) => {
            return Promise.resolve(fileArrays.reduce((p, c) => { return p.push(...c), p;}, []));
        });
    }
}