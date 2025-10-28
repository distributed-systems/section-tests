import Message, { MessageOptions } from './Message.js';
import { ErrorData, Test } from '../types.js';

export interface ErrorMessageOptions extends MessageOptions {
    err: ErrorData;
    test?: Test;
    duration: number;
}

export default class ErrorMessage extends Message {
    err: ErrorData;
    test?: Test;

    constructor(options: ErrorMessageOptions) {
        super(options);
        
        this.err = options.err;
        this.test = options.test;
        this.duration = options.duration;
        this.type = 'errorMessage';
    }
}

