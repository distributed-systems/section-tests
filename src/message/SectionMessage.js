import Message from './Message.js';


export default class SectionMessage extends Message {



    constructor(options) {
        super(options);
        this.type = 'sectionMessage';
    }
};