import Message from './Message.js';




export default class TestSuiteEndMessage extends Message {


    constructor(options) {
        super(options);
        
        this.duration = options.duration;
        this.type = 'testSuiteEndMessage';
        this.failed = options.failed;
        this.ok = options.ok;
    }
};