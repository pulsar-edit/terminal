import { CompositeDisposable, Emitter } from 'atom';
import { IPtyForkOptions, IWindowsPtyForkOptions } from 'node-pty';
import { SpawnOptionsWithoutStdio, type ChildProcess } from 'child_process';
export type PtySpawnOptions = {
    file: string;
    args: string[] | string;
    options: IPtyForkOptions | IWindowsPtyForkOptions;
};
declare enum PtyState {
    CREATED = 0,
    BOOTED = 1,
    READY = 2
}
type PtyMeta = {
    title?: string;
    rows: number;
    cols: number;
    pid: number;
};
type PtyMessageFromWorker = {
    type: 'ready';
    payload: null;
} | {
    type: 'data';
    meta?: Partial<PtyMeta>;
    payload: unknown;
} | {
    type: 'stderr';
    payload: string;
} | {
    type: 'error';
    payload: unknown;
} | {
    type: 'exit';
    payload: {
        exitCode: number;
        signal?: number;
    };
} | {
    type: 'log';
    payload: string;
} | {
    type: 'meta';
    payload: PtyMeta;
};
type PtyMessageSentToWorker = {
    type: 'spawn';
    payload: PtySpawnOptions;
} | {
    type: 'kill';
    payload: {
        signal?: string;
    };
} | {
    type: 'write';
    payload: string;
} | {
    type: 'removeAllListeners';
    payload: string;
} | {
    type: 'resize';
    payload: [number, number];
} | {
    type: 'pause';
    payload: null;
} | {
    type: 'resume';
    payload: null;
} | {
    type: 'clear';
    payload: null;
};
export type PtyMessage = PtyMessageFromWorker | PtyMessageSentToWorker;
export declare class Pty {
    #private;
    readyState: PtyState;
    destroyed: boolean;
    subscriptions: CompositeDisposable;
    id: number;
    process: ChildProcess | null;
    options: PtySpawnOptions;
    emitter: Emitter;
    error: boolean;
    meta: Partial<PtyMeta>;
    get title(): string | undefined;
    get cols(): number | undefined;
    get rows(): number | undefined;
    get pid(): number | undefined;
    constructor(options: PtySpawnOptions);
    onDidChangeReadyState(callback: (readyState: PtyState) => unknown): import("atom").Disposable;
    onData(callback: (data: string) => unknown): import("atom").Disposable;
    onError(callback: (error: unknown) => unknown): import("atom").Disposable;
    onStderr(callback: (data: string) => unknown): import("atom").Disposable;
    onExit(callback: (exitCode: number) => unknown): import("atom").Disposable;
    changeReadyState(newState: PtyState): void;
    start(): Promise<void>;
    emitError(err: unknown): void;
    kill(signal?: string): void;
    forceKill(): void;
    write(data: string): void;
    destroy(): void;
    removeAllListeners(eventType: string): void;
    spawn(command: string, args: readonly string[], options: SpawnOptionsWithoutStdio): import("child_process").ChildProcessWithoutNullStreams;
    booted(): Promise<void>;
    ready(): Promise<void>;
    pause(): void;
    resume(): void;
    clear(): void;
    resize(cols: number, rows: number): void;
}
export {};
