// Manages the creation and destruction of a PTY.
//
// This is moderated through a worker process that runs in a Node-only
// environment so that `node-pty` can run properly.

import * as path from 'path';
import { Emitter } from 'atom';
import { IPtyForkOptions, IWindowsPtyForkOptions } from 'node-pty';
import ndjson from 'ndjson';
import { isWindows, timeout, withResolvers } from './utils';
import { spawn, SpawnOptionsWithoutStdio, type ChildProcess } from 'child_process';

const PACKAGE_ROOT = path.normalize(path.join(__dirname, '..'));
const WORKER_PATH = path.join(PACKAGE_ROOT, 'lib', 'worker', 'pty.js');

export type PtySpawnOptions = {
  file: string,
  args: string[] | string,
  options: IPtyForkOptions | IWindowsPtyForkOptions
}

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
  process: ChildProcess | null = null;
  options: PtySpawnOptions;
  emitter: Emitter = new Emitter();

  error: boolean = false;

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
    this.start();
  }

  onData (callback: (data: string) => unknown) {
    return this.emitter.on('data', callback);
  }

  onExit (callback: (exitCode: number) => unknown) {
    return this.emitter.on('exit', callback);
  }

  async start () {
    console.log('[Terminal] PTY start!');
    let options: SpawnOptionsWithoutStdio = {};

    options.env ??= Object.create(process.env);
    options.env!.ELECTRON_RUN_AS_NODE = '1';
    options.env!.ELECTRON_NO_ATTACH_CONSOLE = '1';

    let args: string[] = [];
    args.unshift(WORKER_PATH);
    args.unshift('--no-deprecation');

    this.error = false;
    this.process = spawn(process.execPath, args, options);
    console.log('[Terminal] Process is', process.execPath, 'args are', args, 'pid is', process.pid);

    let {
      promise: readyPromise,
      resolve: readyResolve,
      reject: readyReject
    } = withResolvers();

    this.process.stdout!
      .pipe(ndjson.parse({ strict: false }))
      .on('data', (obj: PtyMessage) => {
        console.log('[Terminal] Received message of type', obj.type);
        switch (obj.type) {
          case 'ready':
            readyResolve();
            break;
          case 'data':
            if (obj.meta) {
              Object.assign(this.meta, obj.meta);
            }
            console.log('[Terminal] Data is:', obj.payload);
            this.emitter.emit('data', obj.payload);
            break;
          case 'exit':
            this.emitter.emit('exit', obj.payload.exitCode);
            break;
          case 'meta':
            Object.assign(this.meta, obj.payload);
            break;
          case 'log':
            console.log('[Terminal] [Worker]', obj.payload);
            break;
          default:
            // Do nothing
        }
      });

    this.process.stderr!
      .pipe(ndjson.parse({ strict: false }))
      .on('data', (obj: PtyMessage) => {
        console.log('[Terminal] stderr data!', obj);
        if (obj.type !== 'error') return;
        this.emitter.emit('error', obj.payload);
      });

    this.process.on('error', (x) => {
      console.error('[Terminal] ERROR!', x);
      this.error = true;
      readyReject();
    });

    console.log('[Terminal] Waiting for ready…');

    await timeout(readyPromise, 5000);
    console.log('[Terminal] …waited!');

    // let spawned = new Promise<void>((resolve, reject) => {
    //   this.process.on('spawn', () => {
    //     // The `spawn` event will fire whether the spawn was successful or
    //     // unsuccessful. This strategy relies on `error` firing _before_
    //     // `spawn` in the latter case; if this isn't always true, we should try
    //     // a different strategy, like having the worker send an event when it's
    //     // ready.
    //     if (this.error) {
    //       reject(new Error('Failed to spawn PTY'));
    //     } else {
    //       resolve();
    //     }
    //   });
    // });
    //
    // await spawned;

    if (!this.process.stdin) {
      throw new Error('Failed to spawn PTY');
    }

    console.log('[Terminal] PID:', this.process.pid);

    let spawnMessage: PtyMessage = {
      type: 'spawn',
      payload: this.options
    };
    this.#sendMessage(spawnMessage);
  }

  kill (signal?: string) {
    if (isWindows()) {
      this.#killOnWindows();
    } else {
      this.#killProcess(signal);
    }
  }

  write (data: string) {
    let message: PtyMessage = {
      type: 'write',
      payload: data
    };

    this.#sendMessage(message);
  }

  removeAllListeners (eventType: string) {
    let message: PtyMessage = {
      type: 'removeAllListeners',
      payload: eventType
    };
    this.#sendMessage(message);
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
