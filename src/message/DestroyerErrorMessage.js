{
    'use strict';



    const ErrorMessage = require('./ErrorMessage');




    module.exports = class DestroyerErrorMessage extends ErrorMessage {


        constructor(options) {
            super(options);

            this.type = 'destroyerErrorMessage';
        }
    };
}