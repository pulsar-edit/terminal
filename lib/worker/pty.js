'use strict';

var util = require('util');
var nodePty = require('node-pty');
var ndjson = require('ndjson');

function _interopDefault (e) { return e && e.__esModule ? e : { default: e }; }

function _interopNamespace(e) {
    if (e && e.__esModule) return e;
    var n = Object.create(null);
    if (e) {
        Object.keys(e).forEach(function (k) {
            if (k !== 'default') {
                var d = Object.getOwnPropertyDescriptor(e, k);
                Object.defineProperty(n, k, d.get ? d : {
                    enumerable: true,
                    get: function () { return e[k]; }
                });
            }
        });
    }
    n.default = e;
    return Object.freeze(n);
}

var util__namespace = /*#__PURE__*/_interopNamespace(util);
var ndjson__default = /*#__PURE__*/_interopDefault(ndjson);

// A worker script for driving `node-pty`.
//
// `node-pty` expects to be able to use Node’s `worker_threads` library to get
// around an issue on Windows. That means we can’t consume it directly within
// Pulsar's renderer process because of
// https://github.com/electron/electron/issues/18540#issuecomment-665752233.
//
// The workaround is to run a worker script via `ELECTRON_RUN_AS_NODE=1` to use
// `node-pty` in its own isolated Node process. Amazingly, this seems to work
// just fine even though we're running the renderer’s Node rather than the main
// process’s Node.
util__namespace.inspect.defaultOptions.depth = null;
async function spawnPty(file, args, options) {
    let pty = nodePty.spawn(file, args, options);
    pty.onData((data) => emit(data));
    pty.onExit(({ exitCode, signal }) => emitExit(exitCode, signal));
    currentPty = pty;
    return pty;
}
function getMeta() {
    if (!currentPty)
        return undefined;
    // Whenever we send new text to the renderer process, we also send all PTY
    // metadata so that it can be updated on the wrapper object. This allows the
    // user to read the process title, the current row/column count, etc.,
    // without needing to turn those into async requests.
    return {
        title: currentPty.process,
        rows: currentPty.rows,
        cols: currentPty.cols,
        pid: currentPty.pid
    };
}
function emit(obj) {
    let message = {
        type: 'data',
        payload: obj,
        meta: getMeta()
    };
    process.stdout.write(`${JSON.stringify(message)}\n`);
}
function emitError(obj) {
    let message = {
        type: 'error',
        payload: obj
    };
    process.stderr.write(`${JSON.stringify(message)}\n`);
}
function emitMeta() {
    let message = {
        type: 'meta',
        payload: getMeta()
    };
    process.stdout.write(`${JSON.stringify(message)}\n`);
}
function emitReady() {
    let message = { type: 'ready', payload: null };
    process.stdout.write(`${JSON.stringify(message)}\n`);
}
function emitExit(exitCode, signal) {
    let message = { type: 'exit', payload: { exitCode, signal } };
    process.stdout.write(`${JSON.stringify(message)}\n`);
}
function log(obj) {
    return;
}
let currentPty = null;
async function processMessage(data) {
    switch (data.type) {
        case 'spawn':
            let argsDebug = Array.isArray(data.payload.args) ?
                data.payload.args.join(', ') : data.payload.args;
            log(`Spawning PTY with file: ${data.payload.file} and args: ${argsDebug}`);
            try {
                await spawnPty(data.payload.file, data.payload.args, data.payload.options);
            }
            catch (error) {
                emitError(error);
            }
            break;
        case 'kill':
            if (!currentPty)
                return;
            if (process.platform === 'win32' || !data.payload.signal) {
                currentPty.kill();
            }
            else {
                currentPty.kill(data.payload.signal);
            }
            break;
        case 'write':
            if (!currentPty)
                return;
            currentPty.write(data.payload);
            break;
        case 'removeAllListeners':
            if (!currentPty)
                return;
            // @ts-ignore Undocumented.
            currentPty.removeAllListeners(data.payload);
            break;
        case 'resize':
            if (!currentPty)
                return;
            let [cols, rows] = data.payload;
            currentPty.resize(cols, rows);
            emitMeta();
            break;
        case 'pause':
            if (!currentPty)
                return;
            currentPty.pause();
            emitMeta();
            break;
        case 'resume':
            if (!currentPty)
                return;
            currentPty.resume();
            emitMeta();
            break;
        case 'clear':
            if (!currentPty)
                return;
            currentPty.clear();
            emitMeta();
            break;
        // Do nothing.
    }
}
process.title = `node (Pulsar terminal process ${process.pid})`;
// We'll communicate with the parent process via newline-delimited JSON
// messages. This lets us use a newline as a message delimiter without us
// getting confused when we encounter newlines in the data: if it's within a
// JSON message, it's not a message delimiter.
process.stdin
    .pipe(ndjson__default.default.parse())
    .on('data', processMessage);
// By listening to stdin here, we keep the process from exiting for as long as
// stdin exists.
process.stdin.resume();
process.on('uncaughtException', (error) => {
    // When errors happen, we should not try to recover, or do anything that
    // might produce a subsequent error. Instead, our only goal here is to try to
    // raise the visibility of the error and capture some diagnostic information
    // before exiting.
    error.uncaught = true;
    error.error = 'Unknown error';
    try {
        emitError(JSON.stringify(error, Object.getOwnPropertyNames(error)));
    }
    finally {
        process.exit(1);
    }
});
emitReady();
//# sourceMappingURL=pty.js.map
