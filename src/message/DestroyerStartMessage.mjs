'use strict';



import Message from './Message.mjs';




export default class DestroyerStartMessage extends Message {


    constructor(options) {
        super(options);

        this.name = options.name;
        this.type = 'destroyerStartMessage';
    }
};