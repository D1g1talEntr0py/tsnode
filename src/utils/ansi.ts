let colorsEnabled = (process.stdout.isTTY	&& process.env['NO_COLOR'] === undefined && process.env['TERM'] !== 'dumb');

const applyAnsi = (openCode: number, closeCode: number, text: string) => colorsEnabled ? `\u001B[${openCode}m${text}\u001B[${closeCode}m` : text;

const createColor = (openCode: number, closeCode: number) => (text: string) => applyAnsi(openCode, closeCode, text);

export const setColorEnabled = (enabled: boolean) => void (colorsEnabled = enabled);
export const gray = createColor(90, 39);
export const lightCyan = createColor(96, 39);
export const lightMagenta = createColor(95, 39);
export const lightGreen = createColor(92, 39);
export const yellow = createColor(33, 39);
export const bgBlue = createColor(44, 49);
export const bgGray = createColor(100, 49);