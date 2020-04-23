import ErrorMessage from './ErrorMessage.js';




export default class TestErrorMessage extends ErrorMessage {


    constructor(options) {
        super(options);

        this.type = 'testErrorMessage';
    }
};