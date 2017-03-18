{
    'use strict';



    module.exports = class Message {




        constructor({section}) {
            //this.section = section;
            this.sectionName = section.name;
            this.depth = section.getDepth();
            this.type = 'message';
        }
    };
}