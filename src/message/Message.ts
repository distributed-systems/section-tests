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

    constructor({section, duration}: MessageOptions) {
        this.sectionName = section.name;
        this.depth = section.getDepth();
        this.type = 'message';
        this.duration = duration;
    }
}

