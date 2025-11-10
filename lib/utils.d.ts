import { TerminalModel } from "./model";
export declare function isWindows(): boolean;
export declare function isMac(): boolean;
export declare function isLinux(): boolean;
export declare const BASE_URI = "terminal://";
export declare const PACKAGE_NAME = "terminal";
export declare function withResolvers<T extends unknown = void>(): {
    promise: Promise<T>;
    resolve: (value: T | PromiseLike<T>) => void;
    reject: (reason?: any) => void;
};
export declare function recalculateActive(terminals: Set<TerminalModel>, active?: TerminalModel): void;
export declare function getCurrentCwd(): any;
export declare function timeout(promise: Promise<unknown>, timeoutMs?: number, { tag }?: {
    tag?: string;
}): Promise<unknown>;
export declare function debounce(callback: (...args: unknown[]) => void, waitMs?: number): (...args: unknown[]) => void;
export declare function generateUri(params?: Record<string, string>): string;
