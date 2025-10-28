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
    constructor(options: ErrorMessageOptions);
}
//# sourceMappingURL=ErrorMessage.d.ts.map