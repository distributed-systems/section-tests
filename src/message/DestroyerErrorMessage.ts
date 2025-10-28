import ErrorMessage, { ErrorMessageOptions } from './ErrorMessage.js';

export interface DestroyerErrorMessageOptions extends ErrorMessageOptions {
    name: string;
}

export default class DestroyerErrorMessage extends ErrorMessage {
    name: string;

    constructor(options: DestroyerErrorMessageOptions) {
        super(options);

        this.name = options.name;
        this.type = 'destroyerErrorMessage';
    }
}

