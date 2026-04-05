/** Timestamped logger for [masko] trace logs */
const ts = () => new Date().toLocaleTimeString("en-GB", { hour12: false });

export const log = (...args: unknown[]) => console.log(`[masko ${ts()}]`, ...args);
export const warn = (...args: unknown[]) => console.warn(`[masko ${ts()}]`, ...args);
export const error = (...args: unknown[]) => console.error(`[masko ${ts()}]`, ...args);
