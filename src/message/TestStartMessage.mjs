import Message from './Message';




export default class TestStartMessage extends Message {


    constructor(options) {
        super(options);

        this.test = options.test;
        this.type = 'testStartMessage';
    }
};