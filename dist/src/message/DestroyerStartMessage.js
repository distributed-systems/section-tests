import Message from './Message.js';
export default class DestroyerStartMessage extends Message {
    constructor(options) {
        super(options);
        this.name = options.name;
        this.type = 'destroyerStartMessage';
    }
}
//# sourceMappingURL=DestroyerStartMessage.js.map