export default class Message {
    constructor({ section, duration }) {
        this.sectionName = section.name;
        this.depth = section.getDepth();
        this.type = 'message';
        this.duration = duration;
    }
}
//# sourceMappingURL=Message.js.map