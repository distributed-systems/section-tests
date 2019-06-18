'use strict';



import Message from './Message.mjs';




export default class TestStartMessage extends Message {


    constructor(options) {
        super(options);

        this.test = options.test;
        this.type = 'testStartMessage';
    }
};