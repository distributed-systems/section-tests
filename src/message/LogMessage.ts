import Message, { MessageOptions } from './Message.js';

export interface LogMessageOptions extends MessageOptions {
    message: string;
    level: string;
}

export default class LogMessage extends Message {
    message: string;
    level: string;

    constructor(options: LogMessageOptions) {
        super(options);
            
        this.message = options.message;
        this.level = options.level;
        this.type = 'logMessage';
    }
}

