import Message, { MessageOptions } from './Message.js';

export interface DestroyerStartMessageOptions extends MessageOptions {
    name: string;
}

export default class DestroyerStartMessage extends Message {
    name: string;

    constructor(options: DestroyerStartMessageOptions) {
        super(options);

        this.name = options.name;
        this.type = 'destroyerStartMessage';
    }
}

