import Message from './Message.js';
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
    constructor(options: TestSuiteEndMessageOptions);
}
//# sourceMappingURL=TestSuiteEndMessage.d.ts.map