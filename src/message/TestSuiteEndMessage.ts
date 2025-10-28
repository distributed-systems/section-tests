import Message, { MessageOptions } from './Message.js';
import type Section from '../Section.js';

export interface TestSuiteEndMessageOptions {
    duration: number;
    ok: number;
    failed: number;
    section: Section;
}

export default class TestSuiteEndMessage extends Message {
    failed: number;
    ok: number;

    constructor(options: TestSuiteEndMessageOptions) {
        super(options);
        
        this.duration = options.duration;
        this.type = 'testSuiteEndMessage';
        this.failed = options.failed;
        this.ok = options.ok;
    }
}

