import type { ITerminalAddon, Terminal } from '@xterm/xterm';
export type TerminalCommand = {
    commandLine: string | undefined;
    cwd: string | undefined;
    exitCode: number | undefined;
};
export declare class ShellIntegrationAddon implements ITerminalAddon {
    #private;
    activate(terminal: Terminal): void;
    dispose(): void;
    setNonce(nonce: string | undefined): void;
    onDidChangeCwd(callback: (cwd: string) => void): import("atom").Disposable;
    onDidExecuteCommand(callback: (command: TerminalCommand) => void): import("atom").Disposable;
    onDidFinishCommand(callback: (command: TerminalCommand) => void): import("atom").Disposable;
}
