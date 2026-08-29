import type { ILink, ILinkProvider, Terminal } from '@xterm/xterm';
export type LocalPathActivateHandler = (event: MouseEvent, targetPath: string, isDirectory: boolean, line?: number, column?: number) => void;
export declare class LocalPathLinkProvider implements ILinkProvider {
    #private;
    constructor(terminal: Terminal, getCwd: () => string | undefined, activate: LocalPathActivateHandler);
    provideLinks(bufferLineNumber: number, callback: (links: ILink[] | undefined) => void): void;
}
