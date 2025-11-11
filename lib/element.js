'use strict';

var tslib_es6 = require('./node_modules/tslib/tslib.es6.js');
var fs = require('fs-extra');
var atom$1 = require('atom');
var config = require('./config.js');
var xterm = require('@xterm/xterm');
var addonFit = require('@xterm/addon-fit');
var addonWebLinks = require('@xterm/addon-web-links');
var addonWebgl = require('@xterm/addon-webgl');
var addonLigatures = require('@xterm/addon-ligatures');
var addonSearch = require('@xterm/addon-search');
var findPalette = require('./find-palette.js');
var pty = require('./pty.js');
var utils = require('./utils.js');
var themes = require('./themes.js');
var remote = require('@electron/remote');

function _interopDefault (e) { return e && e.__esModule ? e : { default: e }; }

var fs__default = /*#__PURE__*/_interopDefault(fs);

var _TerminalElement_mainResizeObserver, _TerminalElement_mainContentRect, _TerminalElement_terminalIntersectionObserver, _TerminalElement_terminalInitiallyVisible, _TerminalElement_fitAddon, _TerminalElement_searchAddon, _TerminalElement_ptyMeta;
// Given a line height and a font size, attempts to adjust the line height so
// that it results in a pixel height that snaps to the nearest pixel (or
// sub-pixel, taking device pixel ratio into account).
//
// In theory, this would be needed for synchronization with Pulsar, since the
// editor code does something similar. In practice, though, line height values
// seem to be applied differently in XTerm; a shared line-height value between
// the editor and the terminal window results in much taller lines in the
// terminal.
function clampLineHeight(lineHeight, fontSize) {
    let lineHeightInPx = fontSize * lineHeight;
    let roundedScaledLineHeightInPx = Math.round(lineHeightInPx * window.devicePixelRatio);
    return roundedScaledLineHeightInPx / (fontSize * window.devicePixelRatio);
}
class TerminalElement extends HTMLElement {
    constructor() {
        super(...arguments);
        this.initialized = false;
        this.subscriptions = new atom$1.CompositeDisposable();
        _TerminalElement_mainResizeObserver.set(this, void 0);
        _TerminalElement_mainContentRect.set(this, void 0);
        _TerminalElement_terminalIntersectionObserver.set(this, void 0);
        _TerminalElement_terminalInitiallyVisible.set(this, false);
        _TerminalElement_fitAddon.set(this, void 0);
        _TerminalElement_searchAddon.set(this, void 0);
        // Metadata about the PTY.
        _TerminalElement_ptyMeta.set(this, {});
    }
    static create() {
        return document.createElement('pulsar-terminal');
    }
    async initialize(model) {
        this.model = model;
        this.model.setElement(this);
        this.div = {
            top: document.createElement('div'),
            main: document.createElement('div'),
            menu: document.createElement('div'),
            terminal: document.createElement('div'),
            palette: document.createElement('div')
        };
        this.div.top.classList.add('terminal__top');
        this.div.main.classList.add('terminal__main');
        this.div.palette.classList.add('terminal__palette');
        this.div.menu.classList.add('terminal__menu');
        this.div.terminal.classList.add('terminal__terminal');
        this.div.main.appendChild(this.div.terminal);
        this.appendChild(this.div.top);
        this.appendChild(this.div.palette);
        this.appendChild(this.div.main);
        // TODO: Profile menu.
        let initializeResolve;
        let initializeReject;
        this.initializedPromise = new Promise((resolve, reject) => {
            initializeResolve = resolve;
            initializeReject = reject;
        });
        try {
            await this.model.ready();
            this.setAttribute('session-id', this.model.getSessionId());
            let debouncedRefitTerminal = utils.debounce(() => this.refitTerminal());
            tslib_es6.__classPrivateFieldSet(this, _TerminalElement_mainResizeObserver, new ResizeObserver((entries) => {
                let last = entries[entries.length - 1];
                tslib_es6.__classPrivateFieldSet(this, _TerminalElement_mainContentRect, last.contentRect, "f");
                debouncedRefitTerminal();
            }), "f");
            tslib_es6.__classPrivateFieldGet(this, _TerminalElement_mainResizeObserver, "f").observe(this.div.main);
            tslib_es6.__classPrivateFieldSet(this, _TerminalElement_terminalIntersectionObserver, new IntersectionObserver(async (entries) => {
                let last = entries[entries.length - 1];
                if (last.intersectionRatio !== 1.0)
                    return;
                tslib_es6.__classPrivateFieldSet(this, _TerminalElement_terminalInitiallyVisible, true, "f");
                try {
                    await this.createTerminal();
                    initializeResolve();
                }
                catch (error) {
                    initializeReject(error);
                }
                tslib_es6.__classPrivateFieldGet(this, _TerminalElement_terminalIntersectionObserver, "f")?.disconnect();
                tslib_es6.__classPrivateFieldSet(this, _TerminalElement_terminalIntersectionObserver, null, "f");
            }, {
                root: this,
                threshold: 1.0
            }), "f");
            tslib_es6.__classPrivateFieldGet(this, _TerminalElement_terminalIntersectionObserver, "f").observe(this.div.terminal);
            this.subscriptions.add(new atom$1.Disposable(() => tslib_es6.__classPrivateFieldGet(this, _TerminalElement_terminalIntersectionObserver, "f")?.disconnect()));
            this.subscriptions.add(
            // Immediately apply new `fontSize` values when appropriate.
            atom.config.onDidChange('editor.fontSize', ({ newValue }) => {
                if (!config.Config.get('appearance.useEditorFontSize'))
                    return;
                if (!this.terminal)
                    return;
                this.terminal.options.fontSize = newValue;
                this.refitTerminal();
            }), atom.config.onDidChange('terminal.appearance.fontSize', ({ newValue }) => {
                if (config.Config.get('appearance.useEditorFontSize'))
                    return;
                if (!this.terminal)
                    return;
                this.terminal.options.fontSize = newValue;
                this.refitTerminal();
            }));
            // Increase or decrease the font size when holding `Ctrl` and moving the
            // mouse wheel up/down.
            // TODO: Do we need this?
            // this.div.terminal.addEventListener(
            //   'wheel',
            //   (event) => {
            //     if (!event.ctrlKey) return;
            //     if (!atom.config.get('editor.zoomFontWhenCtrlScrolling')) return;
            //     let fontSizeSchema = atom.config.getSchema('terminal.appearance.fontSize');
            //     event.stopPropagation();
            //
            //     let delta = event.deltaY < 0 ? 1 : -1;
            //     let fontSize = Config.get('appearance.fontSize') + delta;
            //     if (fontSize < fontSizeSchema.minimum) {
            //       fontSize = fontSizeSchema.minimum;
            //     } else if (fontSize > fontSizeSchema.maximum) {
            //       fontSize = fontSizeSchema.maximum;
            //     }
            //     Config.set('appearance.fontSize', fontSize);
            //   },
            //   { capture: true }
            // );
        }
        catch (error) {
            initializeReject(error);
            throw error;
        }
        this.initialized = true;
    }
    // Awaits initialization of the terminal. Resolves when a terminal is ready
    // to accept text.
    async ready() {
        return await this.initializedPromise;
    }
    getModel() {
        return this.model;
    }
    destroy() {
        this.pty?.kill();
        this.terminal?.dispose();
        this.subscriptions.dispose();
    }
    getShellCommand() {
        return config.Config.get('terminal.command');
    }
    getArgs() {
        let args = config.Config.get('terminal.args');
        if (!Array.isArray(args)) {
            throw new Error('Arguments must be an array');
        }
        return args;
    }
    getTerminalType() {
        return config.Config.get('terminal.terminalType');
    }
    // Ensures the given path exists and points to a valid directory on disk.
    async pathIsDirectory(filePath) {
        if (!filePath)
            return false;
        try {
            const stats = await fs__default.default.stat(filePath);
            if (stats?.isDirectory())
                return true;
        }
        catch (err) {
            return false;
        }
        return false;
    }
    // Determines the proper `cwd` for this shell.
    async getCwd() {
        if (!this.model)
            return;
        let cwd = this.model.cwd;
        if (await this.pathIsDirectory(cwd)) {
            return cwd;
        }
        cwd = this.model.getPath();
        if (await this.pathIsDirectory(cwd)) {
            return cwd;
        }
        // If we get this far, the `cwd` on the model is invalid!
        if (this.model) {
            this.model.cwd = undefined;
        }
        return undefined;
    }
    getEnv() {
        let env = {};
        let fallbackEnv = config.Config.get('terminal.env.fallbackEnv') ?? {};
        let overrideEnv = config.Config.get('terminal.env.overrideEnv') ?? {};
        let deleteEnv = config.Config.get('terminal.env.deleteEnv') ?? [];
        // First copy over the fallbacks…
        Object.assign(env, fallbackEnv);
        // …then whatever we inherited from `process.env`…
        Object.assign(env, { ...process.env });
        // …then whatever we're overriding.
        Object.assign(env, overrideEnv);
        // Then delete any that shouldn't be there.
        for (let key of deleteEnv) {
            delete env[key];
        }
        return env;
    }
    getEncoding() {
        return config.Config.get('terminal.encoding') ?? 'utf8';
    }
    leaveOpenAfterExit() {
        return config.Config.get('behavior.leaveOpenAfterExit');
    }
    isPtyProcessRunning() {
        return this.pty && tslib_es6.__classPrivateFieldGet(this, _TerminalElement_ptyMeta, "f")?.running;
    }
    getXtermOptions() {
        let extraXtermOptions = config.Config.get('xterm.additionalOptions') ?? {};
        let xtermOptions = {
            cursorBlink: true,
            ...extraXtermOptions
        };
        let fontFamilyKey = config.Config.get('appearance.useEditorFontFamily') ?
            'editor.fontFamily' : 'terminal.appearance.fontFamily';
        let fontSizeKey = config.Config.get('appearance.useEditorFontSize') ?
            'editor.fontSize' : 'terminal.appearance.fontSize';
        let lineHeightKey = config.Config.get('appearance.useEditorLineHeight') ?
            'editor.lineHeight' : 'terminal.appearance.lineHeight';
        xtermOptions.fontFamily = atom.config.get(fontFamilyKey);
        xtermOptions.fontSize = atom.config.get(fontSizeKey);
        let originalLineHeight = atom.config.get(lineHeightKey);
        if (xtermOptions.fontSize) {
            let adjustedLineHeight = clampLineHeight(originalLineHeight, xtermOptions.fontSize);
            xtermOptions.lineHeight = adjustedLineHeight;
        }
        xtermOptions.theme = themes.getTheme();
        if (utils.isWindows()) {
            xtermOptions.windowsPty = {
                backend: utils.willUseConPTY() ? 'conpty' : 'winpty',
                buildNumber: utils.windowsBuildNumber()
            };
        }
        return structuredClone(xtermOptions);
    }
    setMainBackgroundColor(theme = themes.getTheme()) {
        this.style.backgroundColor = theme?.background ?? '#000000';
    }
    async createTerminal() {
        this.setMainBackgroundColor();
        this.terminal = new xterm.Terminal({
            allowProposedApi: true,
            ...this.getXtermOptions()
        });
        tslib_es6.__classPrivateFieldSet(this, _TerminalElement_fitAddon, new addonFit.FitAddon(), "f");
        this.terminal.loadAddon(tslib_es6.__classPrivateFieldGet(this, _TerminalElement_fitAddon, "f"));
        if (config.Config.get('xterm.webLinks')) {
            this.terminal.loadAddon(new addonWebLinks.WebLinksAddon((_, uri) => remote.shell.openExternal(uri)));
        }
        if (this.div) {
            this.terminal.open(this.div.terminal);
        }
        if (config.Config.get('xterm.webgl')) {
            this.terminal.loadAddon(new addonWebgl.WebglAddon());
        }
        this.terminal.loadAddon(new addonLigatures.LigaturesAddon());
        tslib_es6.__classPrivateFieldSet(this, _TerminalElement_searchAddon, new addonSearch.SearchAddon(), "f");
        this.terminal.loadAddon(tslib_es6.__classPrivateFieldGet(this, _TerminalElement_searchAddon, "f"));
        this.findPalette = new findPalette(tslib_es6.__classPrivateFieldGet(this, _TerminalElement_searchAddon, "f"));
        if (this.div) {
            this.div.palette.appendChild(this.findPalette.element);
        }
        tslib_es6.__classPrivateFieldGet(this, _TerminalElement_ptyMeta, "f").cols = 80;
        tslib_es6.__classPrivateFieldGet(this, _TerminalElement_ptyMeta, "f").rows = 25;
        this.refitTerminal();
        tslib_es6.__classPrivateFieldGet(this, _TerminalElement_ptyMeta, "f").running = false;
        this.subscriptions.add(
        // When the terminal receives input, send it to the PTY.
        this.terminal.onData((data) => {
            if (this.isPtyProcessRunning()) {
                this.pty.write(data);
            }
        }), 
        // When the user selects text, we might want to automatically copy it to
        // the clipboard.
        this.terminal.onSelectionChange(() => {
            if (!this.terminal)
                return;
            if (!config.Config.get('behavior.copyTextOnSelect'))
                return;
            let text = this.terminal.getSelection();
            if (!text)
                return;
            let rawLines = text.split(/\r?\n/g);
            let lines = rawLines.map(line => line.replace(/\s/g, ' ').trimRight());
            text = lines.join('\n');
            atom.clipboard.write(text);
        }));
        await this.restartPtyProcess();
    }
    updateTheme() {
        if (!this.terminal)
            return;
        let theme = themes.getTheme();
        this.setMainBackgroundColor(theme);
        this.terminal.options.theme = { ...theme };
    }
    showFind(prefilledText) {
        if (!this.findPalette)
            return false;
        this.findPalette.show();
        if (prefilledText) {
            this.findPalette.search(prefilledText);
        }
        return true;
    }
    toggleFind() {
        if (!this.findPalette)
            return false;
        this.findPalette.toggle();
        return true;
    }
    hideFind() {
        if (!this.findPalette)
            return false;
        this.findPalette.hide();
        return true;
    }
    findNext() {
        if (!this.findPalette)
            return false;
        this.findPalette.findNext();
        return true;
    }
    findPrevious() {
        if (!this.findPalette)
            return false;
        this.findPalette.findPrevious();
        return true;
    }
    showNotification(message, infoType, { restartButtonText = 'Restart', force = false } = {}) {
        if (!config.Config.get('behavior.showNotifications') && !force)
            return;
        let messageElement = document.createElement('div');
        let restartButtonElement = document.createElement('button');
        restartButtonElement.appendChild(document.createTextNode(restartButtonText));
        restartButtonElement.addEventListener('click', () => this.restartPtyProcess(), { passive: true });
        restartButtonElement.classList.add('btn', `btn-${infoType}`, 'terminal__btn-restart');
        messageElement.classList.add(`terminal__notification--${infoType}`);
        messageElement.appendChild(document.createTextNode(message));
        messageElement.appendChild(restartButtonElement);
        if (this.div) {
            this.div.top.innerHTML = ''; // TODO
            this.div.top.appendChild(messageElement);
        }
        switch (infoType) {
            case 'success':
                atom.notifications.addSuccess(message);
                break;
            case 'error':
                atom.notifications.addError(message);
                break;
            case 'warning':
                atom.notifications.addWarning(message);
                break;
            case 'info':
                atom.notifications.addInfo(message);
                break;
            default:
                throw new Error(`Unknown notification type: ${infoType}`);
        }
    }
    async promptToStartup() {
        let message;
        let command = [this.getShellCommand(), ...this.getArgs()];
        message = `New command ${JSON.stringify(command)} ready to start.`;
        this.showNotification(message, 'info', { restartButtonText: 'Start' });
    }
    async restartPtyProcess() {
        if (tslib_es6.__classPrivateFieldGet(this, _TerminalElement_ptyMeta, "f")?.running) {
            this.pty?.removeAllListeners('exit');
            this.pty?.kill();
            tslib_es6.__classPrivateFieldGet(this, _TerminalElement_ptyMeta, "f").running = false;
        }
        let cwd = await this.getCwd();
        this.terminal?.reset();
        tslib_es6.__classPrivateFieldGet(this, _TerminalElement_ptyMeta, "f").options ??= {};
        tslib_es6.__classPrivateFieldGet(this, _TerminalElement_ptyMeta, "f").command = this.getShellCommand();
        tslib_es6.__classPrivateFieldGet(this, _TerminalElement_ptyMeta, "f").args = this.getArgs();
        let name = this.getTerminalType();
        let env = this.getEnv();
        let encoding = this.getEncoding();
        tslib_es6.__classPrivateFieldGet(this, _TerminalElement_ptyMeta, "f").options = { name, cwd, env };
        if (encoding && tslib_es6.__classPrivateFieldGet(this, _TerminalElement_ptyMeta, "f").options) {
            // Only set encoding if there's an actual encoding to set.
            tslib_es6.__classPrivateFieldGet(this, _TerminalElement_ptyMeta, "f").options.encoding = encoding;
        }
        tslib_es6.__classPrivateFieldGet(this, _TerminalElement_ptyMeta, "f").options.cols = this.pty?.cols;
        tslib_es6.__classPrivateFieldGet(this, _TerminalElement_ptyMeta, "f").options.rows = this.pty?.rows;
        // Because we `await` after the we check for the presence of the PTY
        // earlier, we need to check again just to make sure.
        if (tslib_es6.__classPrivateFieldGet(this, _TerminalElement_ptyMeta, "f")?.running || this.pty) {
            this.pty?.removeAllListeners('exit');
            this.pty?.kill();
            tslib_es6.__classPrivateFieldGet(this, _TerminalElement_ptyMeta, "f").running = false;
        }
        this.pty = undefined;
        tslib_es6.__classPrivateFieldGet(this, _TerminalElement_ptyMeta, "f").running = false;
        try {
            this.pty = new pty.Pty({
                file: tslib_es6.__classPrivateFieldGet(this, _TerminalElement_ptyMeta, "f").command ?? '',
                args: tslib_es6.__classPrivateFieldGet(this, _TerminalElement_ptyMeta, "f").args,
                options: tslib_es6.__classPrivateFieldGet(this, _TerminalElement_ptyMeta, "f").options
            });
            if (this.pty.process) {
                this.pty.onData((data) => {
                    if (!this.terminal || !this.model || !this.pty) {
                        throw new Error('No terminal or model for incoming PTY data');
                    }
                    // Whenever we receive data, check for an updated title.
                    if (!utils.isWindows() && this.pty.title) {
                        this.model.title = this.pty.title;
                    }
                    this.terminal.write(data);
                    this.model.handleNewData();
                });
                // Handle the PTY exiting on its own, like if the user runs `exit` or
                // `logout`.
                this.pty.onExit((_exitCode) => {
                    if (!this.terminal || !this.model) {
                        throw new Error('No terminal or model for incoming PTY data');
                    }
                    tslib_es6.__classPrivateFieldGet(this, _TerminalElement_ptyMeta, "f").running = false;
                    if (!this.leaveOpenAfterExit()) {
                        this.model.exit();
                    }
                    else {
                        // TODO: Show a notification whether successful exit or not? Feels
                        // weird.
                    }
                });
                await this.pty.booted();
                tslib_es6.__classPrivateFieldGet(this, _TerminalElement_ptyMeta, "f").running = true;
                this.refitTerminal();
                this.focusTerminal();
                if (this.div) {
                    this.div.top.innerHTML = ''; // TODO
                }
                await this.pty.ready();
                this.refitTerminal();
            }
        }
        catch (error) {
            // TODO: If there's an error in spawning the PTY, it will likely surface
            // in async fashion. But even that seems not to be happening in tests!
            // Pointing to an invalid file path for the initial command doesn't seem
            // to trigger any error; it just does nothing indefinitely.
            let message = `Launching ‘${tslib_es6.__classPrivateFieldGet(this, _TerminalElement_ptyMeta, "f").command}’ raised the following error: ${error.message}`;
            if (error.message.startsWith('File not found:')) {
                message = `Could not find command ‘${tslib_es6.__classPrivateFieldGet(this, _TerminalElement_ptyMeta, "f").command}’.`;
            }
            this.showNotification(message, 'error', { force: true });
            this.pty = undefined;
            tslib_es6.__classPrivateFieldGet(this, _TerminalElement_ptyMeta, "f").running = false;
        }
    }
    clear() {
        this.terminal?.clear();
    }
    refitTerminal() {
        if (!tslib_es6.__classPrivateFieldGet(this, _TerminalElement_terminalInitiallyVisible, "f")) {
            return;
        }
        if (!tslib_es6.__classPrivateFieldGet(this, _TerminalElement_mainContentRect, "f")) {
            return;
        }
        if (tslib_es6.__classPrivateFieldGet(this, _TerminalElement_mainContentRect, "f").height === 0 || tslib_es6.__classPrivateFieldGet(this, _TerminalElement_mainContentRect, "f").width === 0) {
            return;
        }
        tslib_es6.__classPrivateFieldGet(this, _TerminalElement_fitAddon, "f").fit();
        let geometry = tslib_es6.__classPrivateFieldGet(this, _TerminalElement_fitAddon, "f").proposeDimensions();
        if (!geometry || !this.isPtyProcessRunning() || !this.pty) {
            return;
        }
        // We originally had this so that a call to `resize` didn't happen unless
        // the refit resulted in a change in geometry. But we seem to get better
        // results if we call this method redundantly!
        this.pty.resize(geometry.cols, geometry.rows);
        tslib_es6.__classPrivateFieldGet(this, _TerminalElement_ptyMeta, "f").cols = geometry.cols;
        tslib_es6.__classPrivateFieldGet(this, _TerminalElement_ptyMeta, "f").rows = geometry.rows;
    }
    async focusTerminal(double = false) {
        await this.ready();
        if (!this.terminal || !this.model)
            return;
        this.model.setActive();
        this.terminal.focus();
        if (double) {
            // Second focus will send command to pty.
            this.terminal.focus();
        }
    }
    hide() {
        if (!this.div)
            return;
        this.div.terminal.style.visibility = 'hidden';
    }
    show() {
        if (!this.div)
            return;
        this.div.terminal.style.visibility = 'visible';
    }
}
_TerminalElement_mainResizeObserver = new WeakMap(), _TerminalElement_mainContentRect = new WeakMap(), _TerminalElement_terminalIntersectionObserver = new WeakMap(), _TerminalElement_terminalInitiallyVisible = new WeakMap(), _TerminalElement_fitAddon = new WeakMap(), _TerminalElement_searchAddon = new WeakMap(), _TerminalElement_ptyMeta = new WeakMap();
customElements.define('pulsar-terminal', TerminalElement);

exports.TerminalElement = TerminalElement;
//# sourceMappingURL=element.js.map
