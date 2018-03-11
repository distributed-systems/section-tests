'use strict';



import SuccessMessage from './SuccessMessage';




export default class SetupSuccessMessage extends SuccessMessage {


    constructor(options) {
        super(options);

        this.name = options.name;
        this.type = 'setupSuccessMessage';
    }
};