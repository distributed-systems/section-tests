import SuccessMessage, { SuccessMessageOptions } from './SuccessMessage.js';

export interface DestroyerSuccessMessageOptions extends SuccessMessageOptions {
    name: string;
}

export default class DestroyerSuccessMessage extends SuccessMessage {
    name: string;

    constructor(options: DestroyerSuccessMessageOptions) {
        super(options);

        this.name = options.name;
        this.type = 'destroyerSuccessMessage';
    }
}

