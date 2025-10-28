import Message from './Message.js';
export default class TestStartMessage extends Message {
    constructor(options) {
        super(options);
        this.test = options.test;
        this.type = 'testStartMessage';
    }
}
//# sourceMappingURL=TestStartMessage.js.map