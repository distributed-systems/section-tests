'use strict';



import ErrorMessage from './ErrorMessage';




export default class TestErrorMessage extends ErrorMessage {


    constructor(options) {
        super(options);

        this.type = 'testErrorMessage';
    }
};