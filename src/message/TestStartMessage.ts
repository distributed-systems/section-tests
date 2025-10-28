import Message, { MessageOptions } from './Message.js';
import { Test } from '../types.js';

export interface TestStartMessageOptions extends MessageOptions {
    test: Test;
    start: number;
}

export default class TestStartMessage extends Message {
    test: Test;

    constructor(options: TestStartMessageOptions) {
        super(options);

        this.test = options.test;
        this.type = 'testStartMessage';
    }
}

