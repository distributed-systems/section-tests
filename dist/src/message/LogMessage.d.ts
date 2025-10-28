import Message, { MessageOptions } from './Message.js';
export interface LogMessageOptions extends MessageOptions {
    message: string;
    level: string;
}
export default class LogMessage extends Message {
    message: string;
    level: string;
    constructor(options: LogMessageOptions);
}
//# sourceMappingURL=LogMessage.d.ts.map