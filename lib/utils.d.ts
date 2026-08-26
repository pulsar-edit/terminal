import { TerminalModel } from "./model";
export declare function isWindows(): boolean;
export declare function isMac(): boolean;
export declare function isLinux(): boolean;
export declare function willUseConPTY(): boolean;
export declare function windowsBuildNumber(): number | undefined;
export declare const BASE_URI = "terminal://";
export declare const PACKAGE_NAME = "terminal";
export declare const DEFAULT_ELEMENT_NAME = "pulsar-terminal";
/**
 * Picks (and memoizes) the tag name under which this package's custom element
 * gets registered.
 *
 * Prefers `pulsar-terminal`. Falls back to a randomized name if that tag is
 * already claimed by the time this is first called; this can happen whenever
 * this package is dev-linked over a Pulsar release that still ships an early
 * version of the `terminal` package (one that unconditionally registers
 * `pulsar-terminal` even before package activation).
 *
 * Pulsar's package preload step unconditionally `require()`s every bundled
 * package's main module (see `Package.prototype.preload()` in Pulsar core),
 * before dev-linked packages get resolution priority, so the bundled copy's
 * registration can win the tag before this build's own `activate()` ever runs.
 *
 * Since `customElements.define()` can only ever claim a given tag name once,
 * the only way to guarantee this build's element gets used is not to contest
 * that tag at all when it's already spoken for.
 *
 * Nothing but `registerTerminalElement()`/`TerminalElement.create()` (in
 * `element.ts`) should ever need to know the actual tag name. Everything else
 * that needs to find a terminal element (styles, keymaps, the context menu,
 * command scoping, `.closest()` lookups) should target
 * `TERMINAL_ELEMENT_ATTRIBUTE` instead, a stable marker the element sets on
 * itself in `initialize()` regardless of what it's tagged as.
 */
export declare function getElementName(): string;
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
export declare function parseEnvConfigValue(rawJson: string): Record<string, string>;
export declare function humanizeKeystroke(keystroke: string, mac?: boolean): string;
export declare function keystrokeToHTML(keystroke: string, mac?: boolean): string;
