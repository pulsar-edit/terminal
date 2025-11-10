import { CommandEvent, CompositeDisposable, Pane, WorkspaceOpenOptions } from 'atom';
import { TerminalElement } from './element';
import { TerminalModel } from './model';
type OpenOptions = WorkspaceOpenOptions & {
    target?: HTMLElement | EventTarget | null;
};
export default class Terminal {
    static subscriptions: CompositeDisposable;
    static terminals: Set<TerminalModel>;
    static config: Record<string, unknown>;
    static activated: boolean;
    static activate(_state: unknown): void;
    static inferTerminalModel(event?: CommandEvent): TerminalModel | undefined;
    static inferTerminalElement(event: CommandEvent): TerminalElement | null;
    static open(uri: string, options?: OpenOptions): Promise<TerminalModel>;
    static close(): void;
    static restart(event?: CommandEvent): void;
    static copy(event?: CommandEvent): void;
    static paste(event?: CommandEvent): void;
    static clear(event?: CommandEvent): void;
    /**
     * Service function for opening a terminal.
     */
    static openTerminal(options?: OpenOptions): Promise<TerminalModel>;
    static canRunCommands(commands: string[]): Promise<unknown>;
    /**
     * Service function which opens a terminal and runs the given commands.
     *
     * Configuration determines whether a new terminal is opened or an existing
     * terminal is reused.
     *
     * Returns a boolean indicating whether the commands actually ran. There are
     * several reasons why the commands might not run, including: (a) the
     * terminal wasn’t yet active, and (b) the user might not have approved the
     * requested commands.
     */
    static runCommands(commands: string[]): Promise<boolean>;
    static openInCenterOrDock(centerOrDock: {
        getActivePane(): Pane;
    }, options?: OpenOptions): Promise<TerminalModel>;
    static getPath(target: HTMLElement | undefined | null): string | null;
    static addDefaultPosition(options?: OpenOptions): OpenOptions;
    static deactivate(): void;
    static updateTheme(): void;
    static deserializeTerminalModel(serializedModel: {
        uri: string;
    }): TerminalModel | undefined;
    static exitAllTerminals(): void;
    static insertSelection(): void;
    static runSelection(): void;
    static performOnActiveTerminal(operation: (term: TerminalModel) => unknown): void;
    static getActiveTerminal(): TerminalModel | undefined;
    static getSelectedText(): string;
    static focus(): void;
    static focusNext(): void;
    static focusPrevious(): void;
    static unfocus(): void;
    static generateUri(): string;
    static provideTerminalService(): {
        run: (commands: string[]) => Promise<boolean>;
        open: () => Promise<TerminalModel>;
    };
    /**
     * Provide the `platformioIDETerminal` service.
     */
    static providePlatformioIDETerminalService(): {
        run: (commands: string[]) => Promise<boolean>;
        open: () => Promise<TerminalModel>;
        getTerminalViews: () => TerminalModel[];
        updateProcessEnv: (_vars: Record<string, string>) => void;
    };
}
export {};
