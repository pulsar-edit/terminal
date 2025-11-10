'use strict';

var tslib_es6 = require('./node_modules/tslib/tslib.es6.js');
var path = require('path');
var atom = require('atom');
var ndjson = require('ndjson');
var child_process = require('child_process');
var config = require('./config.js');
var utils = require('./utils.js');

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

var path__namespace = /*#__PURE__*/_interopNamespace(path);
var ndjson__default = /*#__PURE__*/_interopDefault(ndjson);

// Manages the creation and destruction of a PTY.
//
// This is moderated through a worker process that runs in a Node-only
// environment so that `node-pty` can run properly.
var _Pty_instances, _Pty_sendMessage, _Pty_killProcess, _Pty_killOnWindows, _Pty_waitForReadyState;
const PACKAGE_ROOT = path__namespace.normalize(path__namespace.join(__dirname, '..'));
const WORKER_PATH = path__namespace.join(PACKAGE_ROOT, 'lib', 'worker', 'pty.js');
function isError(thing) {
    return thing instanceof Error;
}
var PtyState;
(function (PtyState) {
    // We have spawned the worker but have not heard back from it yet.
    PtyState[PtyState["CREATED"] = 0] = "CREATED";
    // The worker says it's ready for messages, but we don't know if the initial
    // command succeeded.
    PtyState[PtyState["BOOTED"] = 1] = "BOOTED";
    // The initial command succeeded, so we can expect to send/receive data.
    PtyState[PtyState["READY"] = 2] = "READY";
})(PtyState || (PtyState = {}));
let uid = 0;
class Pty {
    get title() {
        return this.meta.title ?? undefined;
    }
    get cols() {
        return this.meta.cols ?? undefined;
    }
    get rows() {
        return this.meta.rows ?? undefined;
    }
    get pid() {
        return this.meta.pid ?? undefined;
    }
    constructor(options) {
        _Pty_instances.add(this);
        this.readyState = PtyState.CREATED;
        this.destroyed = false;
        this.subscriptions = new atom.CompositeDisposable();
        this.process = null;
        this.emitter = new atom.Emitter();
        this.error = false;
        // Metadata about the PTY session.
        this.meta = {};
        this.options = options;
        this.id = uid++;
        this.start();
    }
    onDidChangeReadyState(callback) {
        return this.emitter.on('did-change-ready-state', callback);
    }
    onData(callback) {
        return this.emitter.on('data', callback);
    }
    onError(callback) {
        return this.emitter.on('error', callback);
    }
    onStderr(callback) {
        return this.emitter.on('sterr', callback);
    }
    onExit(callback) {
        return this.emitter.on('exit', callback);
    }
    changeReadyState(newState) {
        this.readyState = newState;
        this.emitter.emit('did-change-ready-state', newState);
    }
    async start() {
        let options = {};
        options.env ??= Object.create(process.env);
        options.env.ELECTRON_RUN_AS_NODE = '1';
        options.env.ELECTRON_NO_ATTACH_CONSOLE = '1';
        let args = [];
        args.unshift(WORKER_PATH);
        args.unshift('--no-deprecation');
        this.error = false;
        this.process = this.spawn(process.execPath, args, options);
        this.process.stdout
            .pipe(ndjson__default.default.parse({ strict: false }))
            .on('data', (obj) => {
            if (this.destroyed)
                return;
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
                    if (config.Config.get('advanced.enableDebugLogging')) {
                        console.log('[Terminal] [Worker]', obj.payload);
                    }
                    break;
                // Do nothing
            }
        });
        this.process.stderr
            .pipe(ndjson__default.default.parse({ strict: false }))
            .on('data', (obj) => {
            console.log('GOT STDERR:', obj);
            if (obj.type !== 'stderr')
                return;
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
        await utils.timeout(bootedPromise, 5000, { tag: 'Booted' });
        if (this.destroyed)
            return;
        if (!this.process.stdin) {
            let error = new Error('Failed to spawn PTY');
            this.emitError(error);
        }
        // If we get this far, the PTY is ready to receive the initial command.
        let spawnMessage = {
            type: 'spawn',
            payload: this.options
        };
        tslib_es6.__classPrivateFieldGet(this, _Pty_instances, "m", _Pty_sendMessage).call(this, spawnMessage);
        let firstDataPromise = this.ready();
        // We should not consider this process to have spawned successfully until
        // it sends us data without sending any errors.
        await utils.timeout(firstDataPromise, 5000, { tag: 'Ready' });
    }
    emitError(err) {
        if (this.destroyed)
            return;
        let error;
        if (isError(err)) {
            error = err;
        }
        else if (typeof err === 'string') {
            error = new Error(err);
        }
        else {
            console.log('MAKING', err, 'INTO ERROR!');
            error = new Error(`Unknown error`);
        }
        this.emitter.emit('error', error);
        throw error;
    }
    kill(signal) {
        if (utils.isWindows()) {
            tslib_es6.__classPrivateFieldGet(this, _Pty_instances, "m", _Pty_killOnWindows).call(this);
        }
        else {
            tslib_es6.__classPrivateFieldGet(this, _Pty_instances, "m", _Pty_killProcess).call(this, signal);
        }
        this.destroy();
    }
    forceKill() {
        this.process?.kill('SIGKILL');
    }
    write(data) {
        let message = {
            type: 'write',
            payload: data
        };
        tslib_es6.__classPrivateFieldGet(this, _Pty_instances, "m", _Pty_sendMessage).call(this, message);
    }
    destroy() {
        this.destroyed = true;
        this.subscriptions.dispose();
    }
    removeAllListeners(eventType) {
        let message = {
            type: 'removeAllListeners',
            payload: eventType
        };
        tslib_es6.__classPrivateFieldGet(this, _Pty_instances, "m", _Pty_sendMessage).call(this, message);
    }
    spawn(command, args, options) {
        return child_process.spawn(command, args, options);
    }
    async booted() {
        return await tslib_es6.__classPrivateFieldGet(this, _Pty_instances, "m", _Pty_waitForReadyState).call(this, PtyState.BOOTED);
    }
    async ready() {
        return await tslib_es6.__classPrivateFieldGet(this, _Pty_instances, "m", _Pty_waitForReadyState).call(this, PtyState.READY);
    }
    pause() {
        tslib_es6.__classPrivateFieldGet(this, _Pty_instances, "m", _Pty_sendMessage).call(this, {
            type: 'pause',
            payload: null
        });
    }
    resume() {
        tslib_es6.__classPrivateFieldGet(this, _Pty_instances, "m", _Pty_sendMessage).call(this, {
            type: 'resume',
            payload: null
        });
    }
    clear() {
        tslib_es6.__classPrivateFieldGet(this, _Pty_instances, "m", _Pty_sendMessage).call(this, {
            type: 'clear',
            payload: null
        });
    }
    resize(cols, rows) {
        tslib_es6.__classPrivateFieldGet(this, _Pty_instances, "m", _Pty_sendMessage).call(this, {
            type: 'resize',
            payload: [cols, rows]
        });
    }
}
_Pty_instances = new WeakSet(), _Pty_sendMessage = function _Pty_sendMessage(message) {
    if (!this.process?.stdin)
        return;
    this.process.stdin.write(`${JSON.stringify(message)}\n`);
}, _Pty_killProcess = function _Pty_killProcess(signal) {
    // TODO: Distinguish between killing and graceful exit? This distinction
    // seems not to exist in `node-pty`, nor in VS Code’s terminal.
    let message = {
        type: 'kill',
        payload: {}
    };
    if (!utils.isWindows() && signal) {
        message.payload.signal = signal;
    }
    tslib_es6.__classPrivateFieldGet(this, _Pty_instances, "m", _Pty_sendMessage).call(this, message);
}, _Pty_killOnWindows = function _Pty_killOnWindows() {
    if (!this.process)
        return;
    if (!utils.isWindows())
        return;
    let parentPid = this.process.pid;
    let cmd = 'wmic';
    const args = [
        'process',
        'where',
        `(ParentProcessId=${parentPid})`,
        'get',
        'processid'
    ];
    let wmicProcess;
    try {
        wmicProcess = child_process.spawn(cmd, args);
    }
    catch (spawnError) {
        tslib_es6.__classPrivateFieldGet(this, _Pty_instances, "m", _Pty_killProcess).call(this);
        return;
    }
    if (!wmicProcess.stdout) {
        tslib_es6.__classPrivateFieldGet(this, _Pty_instances, "m", _Pty_killProcess).call(this);
        return;
    }
    wmicProcess.on('error', () => { });
    let output = '';
    wmicProcess.stdout.on('data', (data) => output += data);
    wmicProcess.stdout.on('close', () => {
        for (let rawPid of output.split(/\s+/)) {
            if (!/^\d{1,10}$/.test(rawPid))
                continue;
            let pid = parseInt(rawPid, 10);
            if (!pid || pid === parentPid)
                continue;
            try {
                process.kill(pid);
            }
            catch (error) { }
        }
    });
    tslib_es6.__classPrivateFieldGet(this, _Pty_instances, "m", _Pty_killProcess).call(this);
}, _Pty_waitForReadyState = async function _Pty_waitForReadyState(readyState) {
    if (this.readyState >= readyState) {
        return Promise.resolve();
    }
    return new Promise((resolve, reject) => {
        let disposables = new atom.CompositeDisposable();
        disposables.add(this.onDidChangeReadyState((newState) => {
            if (newState >= readyState) {
                disposables.dispose();
                return resolve();
            }
        }), this.onError((err) => {
            disposables.dispose();
            return reject(err);
        }));
        this.subscriptions.add(disposables);
    });
};

exports.Pty = Pty;
//# sourceMappingURL=pty.js.map
