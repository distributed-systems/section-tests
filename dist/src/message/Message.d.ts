import type Section from '../Section.js';
export interface MessageOptions {
    section: Section;
    duration?: number;
}
export default class Message {
    sectionName: string;
    depth: number;
    type: string;
    duration?: number;
    padAmount?: number;
    constructor({ section, duration }: MessageOptions);
}
//# sourceMappingURL=Message.d.ts.map