'use strict';



import SuccessMessage from './SuccessMessage.mjs';




export default class TestSuccessMessage extends SuccessMessage {


    constructor(options) {
        super(options);

        this.type = 'testSuccessMessage';
    }
};