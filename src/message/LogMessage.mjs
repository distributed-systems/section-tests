import Message from './Message';




export default class LogMessage extends Message {


    constructor(options) {
        super(options);
            
        this.message = options.message;
        this.level = options.level;
        this.type = 'logMessage';
    }
};