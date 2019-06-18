'use strict';



import Message from './Message.mjs';




export default class ErrorMessage extends Message {


    constructor(options) {
        super(options);
        
        this.err = options.err;
        this.test = options.test;
        this.duration = options.duration;
        this.type = 'errorMessage';
    }
};