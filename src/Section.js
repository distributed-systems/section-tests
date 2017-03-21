{
    'use strict';


    const type = require('ee-types');
    const log = require('ee-log');
    const SectionExecutor = require('./SectionExecutor');




    class Section {
        


        constructor({parent, name = 'root', options = {}} = {}) {
            if (parent) this.parent = parent;
            this.name = name;
            this.options = options;


            // store 
            this.childSections = new Map();
            this.tests = new Set();
            this.setups = new Set();
            this.destroyers = new Set();
            this.transports = new Set();
        }






        getDepth(depth = 0) {
            if (this.isRootSection()) return depth;
            else return this.parent.getDepth(depth+1);
        }



        getTransports() {
            return this.collectTransports();
        }





        warn(message) {
            this.log(message, 'warn');
        }

        error(message) {
            this.log(message, 'error');
        }

        success(message) {
            this.log(message, 'success');
        }

        info(message) {
            this.log(message, 'info');
        }

        notice(message) {
            this.log(message, 'notice');
        }

        log(message, level = 'info') {
            if (this.sendLog) this.sendLog(message, level);
            else throw new Error('Cannot log message outside of a test, setup or destroyer routine!');
        }






        collectTransports(transports = []) {
            transports.push(...this.transports.values());

            if (this.isRootSection()) return transports;
            else return this.getRoot().collectTransports(transports);
        }




        getInterface() {

            // return a function that can be invoked by the user
            const iface = this.createSection.bind(this);


            // expose some methods
            iface.test = this.test.bind(this);
            iface.setup = this.setup.bind(this);
            iface.destroy = this.destroy.bind(this);
            iface.execute = this.execute.bind(this);
            iface.use = this.use.bind(this);


            iface.warn = this.warn.bind(this);
            iface.error = this.error.bind(this);
            iface.success = this.success.bind(this);
            iface.info = this.info.bind(this);
            iface.notice = this.notice.bind(this);


            return iface;
        }






        async execute() {
            const section = this;
            const executor = new SectionExecutor({section});
            await executor.execute();
        }







        use(transport) {
            this.transports.add(transport);
        }






        test(...params) {
            let options = {};
            let cb;
            let name = 'anonymous';


            params.forEach((param, index) => {
                if (type.object(param)) options = param;
                else if (type.function(param)) cb = param;
                else if (type.string(param)) name = param;
                else throw new Error(`Ìnvalid option at position ${index}!`);
            });


            this.tests.add({name, cb, options});
        }








        setup(...params) {
            let cb;
            let name = 'Setting Up';

            params.forEach((param, index) => {
                if (type.function(param)) cb = param;
                else if (type.string(param)) name = param;
                else throw new Error(`Ìnvalid option at position ${index}!`);
            });


            this.setups.add({name, cb});
        }








        destroy(...params) {
            let cb;
            let name = 'Destroying';

            params.forEach((param, index) => {
                if (type.function(param)) cb = param;
                else if (type.string(param)) name = param;
                else throw new Error(`Ìnvalid option at position ${index}!`);
            });


            this.destroyers.add({name, cb});
        }








        getRoot() {
            return this.isRootSection() ? this : this.parent.getRoot();
        }




        isRootSection() {
            return !this.parent;
        }




        createSection(...params) {
            let options = {};
            let cb;
            let name = 'anonymous';

            params.forEach((param, index) => {
                if (type.object(param)) options = param;
                else if (type.function(param)) cb = param;
                else if (type.string(param)) name = param;
                else throw new Error(`Ìnvalid option at position ${index}!`);
            });



            if (!this.childSections.has(name)) {
                const parent = this;
                const instance = new Section({name, parent, options});

                this.childSections.set(name, instance);
            }

            cb(this.childSections.get(name).getInterface());
        }
    }






    module.exports = Section;
}