import { Disposable, Dock, Emitter, Pane, PaneItemLocation } from "atom";
import { TerminalElement } from "./element";
export type TerminalModelOptions = {
    terminals: Set<TerminalModel>;
    uri: string;
};
export type Signal = 'SIGTERM' | 'SIGQUIT' | 'SIGINT';
export declare function isSafeSignal(signal: string): signal is Signal;
export declare function controlCharacterForSignal(signal: Signal): void;
/**
 * The representation of a terminal in the Atom workspace.
 */
export declare class TerminalModel {
    #private;
    static is(other: unknown): other is TerminalModel;
    static recalculateActive(terminals: Set<TerminalModel>, active?: TerminalModel): void;
    sessionId: string;
    activeIndex: number;
    title: string;
    initialized: boolean;
    modified: boolean;
    cwd: string | undefined;
    terminals: TerminalModelOptions['terminals'];
    initializedPromise: Promise<void>;
    emitter: Emitter<{
        [key: string]: any;
    }, {}>;
    private url;
    element?: TerminalElement | undefined;
    pane: Pane | undefined;
    dock: Dock | undefined;
    constructor(options: TerminalModelOptions);
    get uri(): string;
    getInitialCwd(): Promise<string>;
    initialize(): Promise<void>;
    serialize(): {
        deserializer: string;
        version: string;
        uri: string;
    };
    destroy(): void;
    getTitle(): string;
    getElement(): TerminalElement;
    getPath(): any;
    getURI(): string;
    getAllowedLocations(): PaneItemLocation[];
    getLongTitle(): string;
    getActiveIndicator(): any;
    getIconName(): string;
    isModified(): boolean;
    setElement(element: TerminalElement | undefined): void;
    onDidChangeTitle(callback: (newTitle: string) => unknown): Disposable;
    onDidChangeModified(callback: (newValue: boolean) => unknown): Disposable;
    handleNewData(): void;
    isActive(): boolean;
    isVisible(): boolean;
    onDidCreateElement(callback: (element: TerminalElement) => unknown): Disposable;
    waitForElement(timeoutMs?: number): Promise<unknown>;
    moveToPane(pane: Pane): void;
    ready(): Promise<void>;
    getSessionId(): string;
    refitTerminal(): void;
    focusTerminal(double?: boolean): Promise<void>;
    exit(): void;
    restartPtyProcess(): void;
    getParams(): Record<string, string>;
    copy(): TerminalModel;
    getSelection(): string | undefined;
    /** Write text into the terminal. */
    paste(text: string): void;
    /** Select all text in the terminal. */
    selectAll(): void;
    /**
     * Run a command.
     *
     * Like {@link paste}, except it inserts a carriage return at the end of the
     * input.
     */
    run(command: string): void;
    /** Clear the screen. */
    clear(): void;
    /** Make this terminal the active terminal. */
    setActive(): void;
    /** Recalculate the theme colors and font metadata. */
    updateTheme(): void;
    setIndex(newIndex: number): void;
}
