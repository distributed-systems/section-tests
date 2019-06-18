'use strict';



import ErrorMessage from './ErrorMessage.mjs';




export default class TestErrorMessage extends ErrorMessage {


    constructor(options) {
        super(options);

        this.type = 'testErrorMessage';
    }
};