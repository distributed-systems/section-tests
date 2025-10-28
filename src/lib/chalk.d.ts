// Type declarations for chalk library (local copy)

interface ChalkStyle {
    (text: string): string;
    bold: ChalkStyle;
    dim: ChalkStyle;
    green: ChalkStyle;
    red: ChalkStyle;
    yellow: ChalkStyle;
    blue: ChalkStyle;
    white: ChalkStyle;
    grey: ChalkStyle;
}

interface Chalk extends ChalkStyle {
    green: ChalkStyle;
    red: ChalkStyle;
    yellow: ChalkStyle;
    blue: ChalkStyle;
    white: ChalkStyle;
    grey: ChalkStyle;
    dim: ChalkStyle;
    bold: ChalkStyle;
}

declare const chalk: Chalk;
export default chalk;

