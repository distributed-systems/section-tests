import ErrorMessage from './ErrorMessage.js';
export default class SetupErrorMessage extends ErrorMessage {
    constructor(options) {
        super(options);
        this.name = options.name;
        this.type = 'setupErrorMessage';
    }
}
//# sourceMappingURL=SetupErrorMessage.js.map