import Message from './Message.js';
export default class SuccessMessage extends Message {
    constructor(options) {
        super(options);
        this.test = options.test;
        this.duration = options.duration;
        this.type = 'successMessage';
    }
}
//# sourceMappingURL=SuccessMessage.js.map