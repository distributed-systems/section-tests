import SuccessMessage, { SuccessMessageOptions } from './SuccessMessage.js';
export interface SetupSuccessMessageOptions extends SuccessMessageOptions {
    name: string;
}
export default class SetupSuccessMessage extends SuccessMessage {
    name: string;
    constructor(options: SetupSuccessMessageOptions);
}
//# sourceMappingURL=SetupSuccessMessage.d.ts.map