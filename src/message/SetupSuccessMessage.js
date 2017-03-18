{
    'use strict';



    const SuccessMessage = require('./SuccessMessage');




    module.exports = class SetupSuccessMessage extends SuccessMessage {


        constructor(options) {
            super(options);

            this.type = 'setupSuccessMessage';
        }
    };
}