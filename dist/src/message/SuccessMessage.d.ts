import Message, { MessageOptions } from './Message.js';
import { Test } from '../types.js';
export interface SuccessMessageOptions extends MessageOptions {
    test?: Test;
    duration: number;
}
export default class SuccessMessage extends Message {
    test?: Test;
    constructor(options: SuccessMessageOptions);
}
//# sourceMappingURL=SuccessMessage.d.ts.map