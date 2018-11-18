import SuccessMessage from './SuccessMessage';




export default class DestroyerSuccessMessage extends SuccessMessage {


    constructor(options) {
        super(options);

        this.name = options.name;
        this.type = 'destroyerSuccessMessage';
    }
};