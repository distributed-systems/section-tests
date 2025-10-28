import ErrorMessage, { ErrorMessageOptions } from './ErrorMessage.js';

export interface SetupErrorMessageOptions extends ErrorMessageOptions {
    name: string;
}

export default class SetupErrorMessage extends ErrorMessage {
    name: string;

    constructor(options: SetupErrorMessageOptions) {
        super(options);

        this.name = options.name;
        this.type = 'setupErrorMessage';
    }
}

