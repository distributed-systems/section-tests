import ErrorMessage from './ErrorMessage.js';
export default class DestroyerErrorMessage extends ErrorMessage {
    constructor(options) {
        super(options);
        this.name = options.name;
        this.type = 'destroyerErrorMessage';
    }
}
//# sourceMappingURL=DestroyerErrorMessage.js.map