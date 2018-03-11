'use strict';



import Message from './Message';




export default class SetupStartMessage extends Message {


    constructor(options) {
        super(options);

        this.name = options.name;
        this.type = 'setupStartMessage';
    }
};