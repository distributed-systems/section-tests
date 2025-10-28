import Message, { MessageOptions } from './Message.js';

export interface SetupStartMessageOptions extends MessageOptions {
    name: string;
}

export default class SetupStartMessage extends Message {
    name: string;

    constructor(options: SetupStartMessageOptions) {
        super(options);

        this.name = options.name;
        this.type = 'setupStartMessage';
    }
}

