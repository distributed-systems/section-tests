{
    'use strict';


    const log = require('ee-log');
    const glob = require('glob');
    const Section = require('./Section');



    module.exports = class TestRunner {



        constructor({patterns}) {
            this.patterns = patterns;
        }




        async execute() {
            const files = await this.getFiles();
            await this.loadFiles(files);

            const section = new Section();
            await section.execute();
        }





        async loadFiles(files) {
            for (const file of files) {
                try {
                    require(file);
                } catch (e) {
                    log.info(`Failed to load ${file}:`);
                    log(e);
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
}