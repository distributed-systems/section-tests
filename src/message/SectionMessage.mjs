'use strict';



import Message from './Message';


export default class SectionMessage extends Message {



    constructor(options) {
        super(options);
        this.type = 'sectionMessage';
    }
};