import { Signal, TerminalModel } from './model';
import { IBufferCellPosition, IBufferRange, ITerminalOptions, ITheme, IViewportRange, Terminal as XTerminal } from '@xterm/xterm';
import { Pty } from './pty';
/**
 * A stable marker the element sets on itself in `initialize()` (not the
 * constructor — see the comment there), regardless of what its tag name
 * happens to be. See `getElementName()` in `utils.ts` for why that can vary.
 * Everything that needs to find a terminal element (styles, keymaps, the
 * context menu, command scoping, `.closest()` lookups, the e2e tests) should
 * target this attribute instead of the tag name.
 *
 * This is needed at least temporarily so that an instance of this package can
 * be linked via `ppm` and shadow the builtin `terminal` package. It will no
 * longer be needed once Pulsar ships a version of `terminal` that does not
 * unconditionally register the `pulsar-terminal` element name at `require`
 * time.
 */
export declare const TERMINAL_ELEMENT_ATTRIBUTE = "data-pulsar-terminal";
type TooltipMetadata = {
    range: IBufferRange;
    rangeType?: 'buffer' | 'viewport';
    uri: string;
};
export declare class TerminalElement extends HTMLElement {
    #private;
    model?: TerminalModel;
    terminal?: XTerminal;
    pty?: Pty;
    initialized: boolean;
    uid: number | undefined;
    private subscriptions;
    private initializedPromise?;
    private createdPromise?;
    private restartingPromise?;
    private findPalette?;
    private tooltip?;
    private tooltipRange?;
    private linkHandler;
    private linkTooltip;
    private div?;
    static create(): TerminalElement;
    constructor();
    initialize(model: TerminalModel): Promise<void>;
    ready(): Promise<void | undefined>;
    activateLink(event: MouseEvent, uri: string, _range?: IBufferRange): void;
    showHoverTooltip(range: IBufferRange | IViewportRange, uri: string, rangeType?: 'buffer' | 'viewport'): void;
    hideHoverTooltip(_range: TooltipMetadata['range'], _uri: string): void;
    hoverLink(_event: MouseEvent, uri: string, range?: IBufferRange | IViewportRange, rangeType?: 'buffer' | 'viewport'): void;
    leaveLink(_event: MouseEvent, uri: string, range?: IBufferRange): void;
    /**
     * Open the given URI within Pulsar.
     *
     * Exact behavior varies according to the user's configuration.
     */
    openInPulsar(uri: string, isDirectory?: boolean): Promise<void>;
    getModel(): TerminalModel | undefined;
    destroy(): void;
    getShellCommand(): any;
    getArgs(): any[];
    getTerminalType(): any;
    pathIsDirectory(filePath: string | undefined | null): Promise<boolean>;
    getCwd(): Promise<string | undefined>;
    getEnv(): Record<string, string>;
    getEncoding(): any;
    leaveOpenAfterExit(): any;
    isPtyProcessRunning(): boolean | undefined;
    getExtraXTermOptions(): Partial<ITerminalOptions>;
    getXtermOptions(): ITerminalOptions;
    setMainBackgroundColor(theme?: ITheme): void;
    optionallyWarnAboutModifierlessClick(): void;
    /**
     * Activates a path detected by `LocalPathLinkProvider`. `targetPath` is
     * already an absolute, filesystem-verified path (not a URI) by the time it
     * reaches this method; resolution and validation both happen in the
     * provider.
     */
    activateLocalPathLink(event: MouseEvent, targetPath: string, isDirectory: boolean, line?: number, column?: number): void;
    /**
     * Instantiates a new terminal.
     *
     * Async; if a terminal creation is already in flight, subsequent calls will
     * return the promise tied to the existing terminal creation.
     */
    createTerminal(): Promise<void>;
    waitForShellEnvironment(timeoutMs?: number): Promise<unknown>;
    updateTheme(): void;
    showFind(prefilledText?: string): Promise<boolean>;
    toggleFind(): boolean;
    hideFind(): boolean;
    findNext(): boolean;
    findPrevious(): boolean;
    showNotification(message: string, infoType: string, { restartButtonText, force }?: {
        restartButtonText?: string;
        force?: boolean;
    }): void;
    promptToStartup(): Promise<void>;
    /**
     * Starts or restarts the PTY.
     *
     * Async; if a process restart is already in flight, subsequent calls will
     * return the promise tied to the existing restart.
     */
    restartPtyProcess(): Promise<void>;
    clear(): void;
    sendSignal(signal: Signal): boolean;
    refitTerminal(): void;
    focusTerminal(double?: boolean): Promise<void>;
    selectAll(): void;
    hide(): void;
    show(): void;
    pointsAreEqual(a: IBufferCellPosition, b: IBufferCellPosition): boolean;
    rangesAreEqual(a: IBufferRange | undefined, b: IBufferRange | undefined): boolean;
    inspectPoint(cell: IBufferCellPosition): string;
    inspectRange(range: IBufferRange | undefined): string;
}
export declare function registerTerminalElement(): void;
export {};
