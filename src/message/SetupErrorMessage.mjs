'use strict';



import ErrorMessage from './ErrorMessage.mjs';




export default class SetupErrorMessage extends ErrorMessage {


    constructor(options) {
        super(options);

        this.name = options.name;
        this.type = 'setupErrorMessage';
    }
};