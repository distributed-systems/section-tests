import SuccessMessage from './SuccessMessage.js';




export default class SetupSuccessMessage extends SuccessMessage {


    constructor(options) {
        super(options);

        this.name = options.name;
        this.type = 'setupSuccessMessage';
    }
};