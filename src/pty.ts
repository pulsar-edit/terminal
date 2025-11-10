// Manages the creation and destruction of a PTY.
//
// This is moderated through a worker process that runs in a Node-only
// environment so that `node-pty` can run properly.

import * as path from 'path';
import { CompositeDisposable, Emitter } from 'atom';
import { IPtyForkOptions, IWindowsPtyForkOptions } from 'node-pty';
import ndjson from 'ndjson';
import { spawn, SpawnOptionsWithoutStdio, type ChildProcess } from 'child_process';

import { Config } from './config';
import { isWindows, timeout, withResolvers } from './utils';

const PACKAGE_ROOT = path.normalize(path.join(__dirname, '..'));
const WORKER_PATH = path.join(PACKAGE_ROOT, 'lib', 'worker', 'pty.js');

export type PtySpawnOptions = {
  file: string,
  args: string[] | string,
  options: IPtyForkOptions | IWindowsPtyForkOptions
}

function isError (thing: unknown): thing is Error {
  return thing instanceof Error;
}

enum PtyState {
  // We have spawned the worker but have not heard back from it yet.
  CREATED,
  // The worker says it's ready for messages, but we don't know if the initial
  // command succeeded.
  BOOTED,
  // The initial command succeeded, so we can expect to send/receive data.
  READY
};

let uid = 0;

type PtyMeta = {
  title?: string;
  rows: number;
  cols: number;
  pid: number;
}

type PtyMessageFromWorker = {
  type: 'ready',
  payload: null
} | {
  type: 'data',
  meta?: Partial<PtyMeta>,
  payload: unknown
} | {
  type: 'stderr',
  payload: string
} | {
  type: 'error',
  payload: unknown
} | {
  type: 'exit',
  payload: { exitCode: number, signal?: number }
} | {
  type: 'log',
  payload: string
} | {
  type: 'meta',
  payload: PtyMeta
}

type PtyMessageSentToWorker = {
  type: 'spawn',
  payload: PtySpawnOptions
} | {
  type: 'kill',
  payload: { signal?: string }
} | {
  type: 'write',
  payload: string;
} | {
  type: 'removeAllListeners',
  payload: string
} | {
  type: 'resize',
  payload: [number, number]
} | {
  type: 'pause',
  payload: null
} | {
  type: 'resume',
  payload: null
} | {
  type: 'clear',
  payload: null
};

export type PtyMessage = PtyMessageFromWorker | PtyMessageSentToWorker;

export class Pty {
  public readyState: PtyState = PtyState.CREATED;
  public destroyed: boolean = false;
  public subscriptions = new CompositeDisposable();

  id: number;
  public process: ChildProcess | null = null;
  public options: PtySpawnOptions;
  public emitter: Emitter = new Emitter();

  public error: boolean = false;

  // Metadata about the PTY session.
  meta: Partial<PtyMeta> = {};

  get title() {
    return this.meta.title ?? undefined;
  }

  get cols () {
    return this.meta.cols ?? undefined;
  }

  get rows () {
    return this.meta.rows ?? undefined;
  }

  get pid () {
    return this.meta.pid ?? undefined;
  }

  constructor(options: PtySpawnOptions) {
    this.options = options;
    this.id = uid++;
    this.start();
  }

  onDidChangeReadyState (callback: (readyState: PtyState) => unknown) {
    return this.emitter.on('did-change-ready-state', callback);
  }

  onData (callback: (data: string) => unknown) {
    return this.emitter.on('data', callback);
  }

  onError (callback: (error: unknown) => unknown) {
    return this.emitter.on('error', callback);
  }

  onStderr (callback: (data: string) => unknown) {
    return this.emitter.on('sterr', callback);
  }

  onExit (callback: (exitCode: number) => unknown) {
    return this.emitter.on('exit', callback);
  }

  changeReadyState (newState: PtyState) {
    this.readyState = newState;
    this.emitter.emit('did-change-ready-state', newState);
  }

  async start () {
    let options: SpawnOptionsWithoutStdio = {};

    options.env ??= Object.create(process.env);
    options.env!.ELECTRON_RUN_AS_NODE = '1';
    options.env!.ELECTRON_NO_ATTACH_CONSOLE = '1';

    let args: string[] = [];
    args.unshift(WORKER_PATH);
    args.unshift('--no-deprecation');

    this.error = false;
    this.process = this.spawn(process.execPath, args, options);

    this.process.stdout!
      .pipe(ndjson.parse({ strict: false }))
      .on('data', (obj: PtyMessage) => {
        if (this.destroyed) return;
        switch (obj.type) {
          case 'ready':
            if (this.readyState < PtyState.BOOTED) {
              this.changeReadyState(PtyState.BOOTED);
            }
            if (this.readyState > PtyState.BOOTED) {
              console.warn(`Warning: PTY in weird state (ready before booting?)`);
            }
            break;
          case 'data':
            if (this.readyState !== PtyState.READY) {
              this.changeReadyState(PtyState.READY);
            }
            if (obj.meta) {
              Object.assign(this.meta, obj.meta);
            }
            this.emitter.emit('data', obj.payload);
            break;
          case 'exit':
            this.emitter.emit('exit', obj.payload.exitCode);
            break;
          case 'meta':
            Object.assign(this.meta, obj.payload);
            break;
          case 'log':
            if (Config.get('advanced.enableDebugLogging')) {
              console.log('[Terminal] [Worker]', obj.payload);
            }
            break;
          default:
            // Do nothing
        }
      });

    this.process.stderr!
      .pipe(ndjson.parse({ strict: false }))
      .on('data', (obj: PtyMessage) => {
        console.log('GOT STDERR:', obj);
        if (obj.type !== 'stderr') return;
        this.emitter.emit('stderr', obj.payload);
      });

    this.process.on('error', (err) => {
      console.error('[Terminal] Error from PTY:', err);
      this.error = true;
      // These will be no-ops if their associated promises have already
      // resolved.
      this.emitter.emit('error', err);
      this.kill();
    });

    let bootedPromise = this.booted();

    console.log('PTY', this.id, 'waiting for boot…', performance.now());
    await timeout(bootedPromise, 5000, { tag: 'Booted' });
    console.log('…booted!', this.id, performance.now());
    if (this.destroyed) return;

    if (!this.process.stdin) {
      let error = new Error('Failed to spawn PTY');
      this.emitError(error);
    }
    console.log('ABOUT TO SPAWN FOR PTY', this.id);

    // If we get this far, the PTY is ready to receive the initial command.
    let spawnMessage: PtyMessage = {
      type: 'spawn',
      payload: this.options
    };
    this.#sendMessage(spawnMessage);
    console.log('PTY', this.id, 'sent message');

    let firstDataPromise = this.ready();

    // We should not consider this process to have spawned successfully until
    // it sends us data without sending any errors.
    await timeout(firstDataPromise, 5000, { tag: 'Ready' });
  }

  emitError (err: unknown) {
    if (this.destroyed) return;
    let error: Error;
    if (isError(err)) {
      error = err;
    } else if (typeof err === 'string') {
      error = new Error(err);
    } else {
      console.log('MAKING', err, 'INTO ERROR!');
      error = new Error(`Unknown error`);
    }
    this.emitter.emit('error', error);
    throw error;
  }

  kill (signal?: string) {
    console.log('Killing PTY', this.id);
    if (isWindows()) {
      this.#killOnWindows();
    } else {
      this.#killProcess(signal);
    }
    this.destroy();
  }

  forceKill () {
    this.process?.kill('SIGKILL');
  }

  write (data: string) {
    let message: PtyMessage = {
      type: 'write',
      payload: data
    };

    this.#sendMessage(message);
  }

  destroy () {
    this.destroyed = true;
    this.subscriptions.dispose();
  }

  removeAllListeners (eventType: string) {
    let message: PtyMessage = {
      type: 'removeAllListeners',
      payload: eventType
    };
    this.#sendMessage(message);
  }

  spawn (
    command: string,
    args: readonly string[],
    options: SpawnOptionsWithoutStdio
  ) {
    return spawn(command, args, options);
  }

  #sendMessage(message: PtyMessage) {
    if (!this.process?.stdin) return;
    this.process.stdin.write(`${JSON.stringify(message)}\n`);
  }

  #killProcess(signal?: string) {
    // TODO: Distinguish between killing and graceful exit? This distinction
    // seems not to exist in `node-pty`, nor in VS Code’s terminal.
    let message: PtyMessage = {
      type: 'kill',
      payload: {}
    };
    if (!isWindows() && signal) {
      message.payload.signal = signal;
    }
    this.#sendMessage(message);
  }

  #killOnWindows () {
    if (!this.process) return;
    if (!isWindows()) return;

    let parentPid = this.process.pid;
    let cmd = 'wmic';
    const args = [
      'process',
      'where',
      `(ParentProcessId=${parentPid})`,
      'get',
      'processid'
    ];

    let wmicProcess: ChildProcess;
    try {
      wmicProcess = spawn(cmd, args);
    } catch (spawnError) {
      this.#killProcess();
      return;
    }
    if (!wmicProcess.stdout) {
      this.#killProcess();
      return;
    }

    wmicProcess.on('error', () => {});

    let output = '';
    wmicProcess.stdout.on('data', (data: string) => output += data);
    wmicProcess.stdout.on('close', () => {
      for (let rawPid of output.split(/\s+/)) {
        if (!/^\d{1,10}$/.test(rawPid)) continue;
        let pid = parseInt(rawPid, 10);

        if (!pid || pid === parentPid) continue;

        try {
          process.kill(pid);
        } catch (error) {}
      }
    });

    this.#killProcess();
  }

  async #waitForReadyState (readyState: PtyState) {
    if (this.readyState >= readyState) {
      return Promise.resolve();
    }
    return new Promise<void>((resolve, reject) => {
      let disposables = new CompositeDisposable();
      disposables.add(
        this.onDidChangeReadyState((newState) => {
          if (newState >= readyState) {
            disposables.dispose();
            return resolve();
          }
        }),

        this.onError((err) => {
          disposables.dispose();
          return reject(err);
        })
      );
      this.subscriptions.add(disposables);
    });
  }

  async booted () {
    return await this.#waitForReadyState(PtyState.BOOTED);
  }

  async ready () {
    return await this.#waitForReadyState(PtyState.READY);
  }

  pause () {
    this.#sendMessage({
      type: 'pause',
      payload: null
    });
  }

  resume () {
    this.#sendMessage({
      type: 'resume',
      payload: null
    });
  }

  clear () {
    this.#sendMessage({
      type: 'clear',
      payload: null
    });
  }

  resize (cols: number, rows: number) {
    this.#sendMessage({
      type: 'resize',
      payload: [cols, rows]
    });
  }
}
