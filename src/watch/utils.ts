import { gray, lightCyan } from '../utils/ansi';

export const log = (...messages: unknown[]) => console.log(gray(new Date().toLocaleTimeString()), lightCyan('[tsnode]'), ...messages);

// From ansi-escapes
// https://github.com/sindresorhus/ansi-escapes/blob/2b3b59c56ff77a/index.js#L80
export const clearScreen = '\u001Bc';