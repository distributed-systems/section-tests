import SuccessMessage, { SuccessMessageOptions } from './SuccessMessage.js';

export default class TestSuccessMessage extends SuccessMessage {
    constructor(options: SuccessMessageOptions) {
        super(options);
        this.type = 'testSuccessMessage';
    }
}

