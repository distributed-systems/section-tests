'use strict';



import ErrorMessage from './ErrorMessage';




export default class DestroyerErrorMessage extends ErrorMessage {


    constructor(options) {
        super(options);

        this.name = options.name;
        this.type = 'destroyerErrorMessage';
    }
};