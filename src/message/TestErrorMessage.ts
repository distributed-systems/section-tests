import ErrorMessage, { ErrorMessageOptions } from './ErrorMessage.js';

export default class TestErrorMessage extends ErrorMessage {
    constructor(options: ErrorMessageOptions) {
        super(options);
        this.type = 'testErrorMessage';
    }
}

