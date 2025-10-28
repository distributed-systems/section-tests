import Message, { MessageOptions } from './Message.js';

export default class SectionMessage extends Message {
    constructor(options: MessageOptions) {
        super(options);
        this.type = 'sectionMessage';
    }
}

