'use strict';



import Message from './Message.mjs';




export default class LogMessage extends Message {


    constructor(options) {
        super(options);
            
        this.message = options.message;
        this.level = options.level;
        this.type = 'logMessage';
    }
};