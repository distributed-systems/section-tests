import SuccessMessage from './SuccessMessage.js';
export default class DestroyerSuccessMessage extends SuccessMessage {
    constructor(options) {
        super(options);
        this.name = options.name;
        this.type = 'destroyerSuccessMessage';
    }
}
//# sourceMappingURL=DestroyerSuccessMessage.js.map