'use strict';

var tslib = require('tslib');
var fs = require('fs-extra');
var url = require('url');
var atom$1 = require('atom');
var model = require('./model.js');
var config = require('./config.js');
var log = require('./log.js');
var xterm = require('@xterm/xterm');
var addonFit = require('@xterm/addon-fit');
var addonWebLinks = require('@xterm/addon-web-links');
var addonWebgl = require('@xterm/addon-webgl');
var _addonLigatures = require('./_virtual/_addon-ligatures.js');
var addonSearch = require('@xterm/addon-search');
var findPalette = require('./find-palette.js');
var pty = require('./pty.js');
var utils = require('./utils.js');
var themes = require('./themes.js');
var remote = require('@electron/remote');

function _interopDefault (e) { return e && e.__esModule ? e : { default: e }; }

var fs__default = /*#__PURE__*/_interopDefault(fs);

var _DelayedPresence_instances, _DelayedPresence_inState, _DelayedPresence_isSame, _DelayedPresence_reset, _DelayedPresence_effectiveShowDelay, _DelayedPresence_cancelTimer, _TerminalElement_instances, _TerminalElement_mainResizeObserver, _TerminalElement_mainContentRect, _TerminalElement_terminalIntersectionObserver, _TerminalElement_terminalInitiallyVisible, _TerminalElement_fitAddon, _TerminalElement_searchAddon, _TerminalElement_webglAddon, _TerminalElement_prioritizedPrefixes, _TerminalElement_ptyMeta, _TerminalElement_loseWebglContext, _TerminalElement_shouldPrioritizeBinding, _TerminalElement_keymapHasPendingPartialMatches, _TerminalElement_keyboardEventMatchesKeybinding, _TerminalElement_createTerminal;
/**
 * A stable marker the element sets on itself in `initialize()` (not the
 * constructor — see the comment there), regardless of what its tag name
 * happens to be. See `getElementName()` in `utils.ts` for why that can vary.
 * Everything that needs to find a terminal element (styles, keymaps, the
 * context menu, command scoping, `.closest()` lookups) should target this
 * attribute instead of the tag name.
 *
 * This is needed at least temporarily so that an instance of this package can
 * be linked via `ppm` and shadow the builtin `terminal` package. It will no
 * longer be needed once Pulsar ships a version of `terminal` that does not
 * unconditionally register the `pulsar-terminal` element name at `require`
 * time.
 */
const TERMINAL_ELEMENT_ATTRIBUTE = 'data-pulsar-terminal';
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
// Takes a DOM `KeyboardEvent` whose default was already prevented and creates
// a fresh event so we can re-propagate it upward. This allows certain key
// bindings and key sequences to keep working even if some of their events are
// swallowed by xterm.js.
function redispatchKeyboardEvent(originalEvent, targetElement) {
    let newEvent = new KeyboardEvent(originalEvent.type, {
        bubbles: true,
        cancelable: true,
        key: originalEvent.key,
        code: originalEvent.code,
        location: originalEvent.location,
        ctrlKey: originalEvent.ctrlKey,
        shiftKey: originalEvent.shiftKey,
        altKey: originalEvent.altKey,
        metaKey: originalEvent.metaKey,
        repeat: originalEvent.repeat,
        isComposing: originalEvent.isComposing
    });
    targetElement.dispatchEvent(newEvent);
}
/**
 * A state machine that uses delays between state changes to guard against
 * rapid state fluctuation.
 *
 * Methods accept a key that scopes the state machine; this helps us know when
 * to reset the state machine and when to ignore stale requests to transition.
 *
 * We use this as a way of manually managing show/hide delays on tooltips.
 */
class DelayedPresence {
    constructor(options) {
        _DelayedPresence_instances.add(this);
        this.state = 'idle';
        this.options = options;
    }
    enter(key) {
        if (tslib.__classPrivateFieldGet(this, _DelayedPresence_instances, "m", _DelayedPresence_inState).call(this, 'shown', 'pending-hide') && tslib.__classPrivateFieldGet(this, _DelayedPresence_instances, "m", _DelayedPresence_isSame).call(this, key)) {
            // Same target re-entered before the hide timer fired; cancel it and stay
            // shown. This filters out spurious mouseout events.
            tslib.__classPrivateFieldGet(this, _DelayedPresence_instances, "m", _DelayedPresence_cancelTimer).call(this);
            this.state = 'shown';
            return;
        }
        if (!tslib.__classPrivateFieldGet(this, _DelayedPresence_instances, "m", _DelayedPresence_inState).call(this, 'idle')) {
            // Different target, or else same target still pending its first show.
            // Tear down whatever is in flight and start over.
            tslib.__classPrivateFieldGet(this, _DelayedPresence_instances, "m", _DelayedPresence_reset).call(this);
        }
        this.currentKey = key;
        this.state = 'pending-show';
        let delay = tslib.__classPrivateFieldGet(this, _DelayedPresence_instances, "m", _DelayedPresence_effectiveShowDelay).call(this);
        if (delay <= 0) {
            this.state = 'shown';
            this.options.onShow(key);
            return;
        }
        this.timer = setTimeout(() => {
            this.state = 'shown';
            this.options.onShow(key);
        }, this.options.showDelay ?? 0);
    }
    leave(key) {
        if (!tslib.__classPrivateFieldGet(this, _DelayedPresence_instances, "m", _DelayedPresence_isSame).call(this, key)) {
            // A stale leave for a target we've already left.
            return;
        }
        tslib.__classPrivateFieldGet(this, _DelayedPresence_instances, "m", _DelayedPresence_cancelTimer).call(this);
        if (tslib.__classPrivateFieldGet(this, _DelayedPresence_instances, "m", _DelayedPresence_inState).call(this, 'pending-show')) {
            this.state = 'idle';
            this.currentKey = undefined;
            return;
        }
        if (tslib.__classPrivateFieldGet(this, _DelayedPresence_instances, "m", _DelayedPresence_inState).call(this, 'shown')) {
            this.state = 'pending-hide';
            this.timer = setTimeout(() => {
                this.state = 'idle';
                this.lastHideAt = Date.now();
                this.options.onHide(key);
                this.currentKey = undefined;
            }, this.options.hideDelay ?? 0);
        }
    }
    dispose() {
        tslib.__classPrivateFieldGet(this, _DelayedPresence_instances, "m", _DelayedPresence_reset).call(this);
    }
    // Like `dispose`, but only resets when the key matches.
    dismiss(key) {
        if (key !== undefined && !tslib.__classPrivateFieldGet(this, _DelayedPresence_instances, "m", _DelayedPresence_isSame).call(this, key))
            return;
        tslib.__classPrivateFieldGet(this, _DelayedPresence_instances, "m", _DelayedPresence_reset).call(this);
    }
}
_DelayedPresence_instances = new WeakSet(), _DelayedPresence_inState = function _DelayedPresence_inState(...states) {
    if (states.length === 1) {
        return this.state === states[0];
    }
    return states.some(s => this.state === s);
}, _DelayedPresence_isSame = function _DelayedPresence_isSame(key) {
    if (this.currentKey === undefined)
        return false;
    return this.options.isSameKey?.(key, this.currentKey) ?? key === this.currentKey;
}, _DelayedPresence_reset = function _DelayedPresence_reset() {
    tslib.__classPrivateFieldGet(this, _DelayedPresence_instances, "m", _DelayedPresence_cancelTimer).call(this);
    if (tslib.__classPrivateFieldGet(this, _DelayedPresence_instances, "m", _DelayedPresence_inState).call(this, 'shown', 'pending-hide') && this.currentKey !== undefined) {
        this.lastHideAt = Date.now();
        this.options.onHide(this.currentKey);
    }
    this.state = 'idle';
    this.currentKey = undefined;
}, _DelayedPresence_effectiveShowDelay = function _DelayedPresence_effectiveShowDelay() {
    let showDelay = this.options.showDelay ?? 0;
    if (this.lastHideAt === undefined)
        return showDelay;
    let intentWindow = this.options.intentWindow ?? showDelay;
    let isWarm = (Date.now() - this.lastHideAt) < intentWindow;
    return isWarm ? (this.options.fastShowDelay ?? 0) : showDelay;
}, _DelayedPresence_cancelTimer = function _DelayedPresence_cancelTimer() {
    if (this.timer)
        clearTimeout(this.timer);
    this.timer = undefined;
};
/**
 * A link handler class designed to fulfill both the interfaces related to link
 * handling (even though they differ from one another very slightly).
 */
class TerminalLinkHandler {
    constructor(options) {
        this.allowNonHttpProtocols = true;
        this.options = options;
    }
    activate(event, text, range) {
        this.activateWithOptionalRange(event, text, range);
    }
    hover(event, text, range) {
        this.hoverWithOptionalRange(event, text, range, 'buffer');
    }
    leave(event, text, range) {
        this.leaveWithOptionalRange(event, text, range);
    }
    activateWithOptionalRange(event, text, range) {
        return this.options.activate(event, text, range);
    }
    hoverWithOptionalRange(event, text, range, rangeType) {
        return this.options.hover?.(event, text, range, rangeType);
    }
    leaveWithOptionalRange(event, text, range) {
        return this.options.leave?.(event, text, range);
    }
}
class TerminalElement extends HTMLElement {
    static create() {
        return document.createElement(utils.getElementName());
    }
    constructor() {
        super();
        _TerminalElement_instances.add(this);
        this.initialized = false;
        this.uid = undefined;
        this.subscriptions = new atom$1.CompositeDisposable();
        _TerminalElement_mainResizeObserver.set(this, void 0);
        _TerminalElement_mainContentRect.set(this, void 0);
        _TerminalElement_terminalIntersectionObserver.set(this, void 0);
        _TerminalElement_terminalInitiallyVisible.set(this, false);
        _TerminalElement_fitAddon.set(this, void 0);
        _TerminalElement_searchAddon.set(this, void 0);
        _TerminalElement_webglAddon.set(this, null);
        _TerminalElement_prioritizedPrefixes.set(this, []);
        // Metadata about the PTY.
        _TerminalElement_ptyMeta.set(this, {});
        this.linkHandler = new TerminalLinkHandler({
            activate: (event, text, range) => this.activateLink(event, text, range),
            hover: (event, text, range) => this.hoverLink(event, text, range, 'buffer'),
            leave: (event, text, range) => this.leaveLink(event, text, range)
        });
        this.linkTooltip = new DelayedPresence({
            showDelay: atom.inSpecMode() ? 10 : 1000,
            hideDelay: atom.inSpecMode() ? 10 : 100,
            isSameKey: (a, b) => this.rangesAreEqual(a.range, b.range),
            onShow: ({ range, uri, rangeType }) => {
                return this.showHoverTooltip(range, uri, rangeType);
            },
            onHide: ({ range, uri }) => {
                return this.hideHoverTooltip(range, uri);
            }
        });
    }
    async initialize(model) {
        // Not in the constructor: custom element constructors must not set
        // attributes on themselves (or have any other side effects beyond
        // `super()` and internal state setup) — Atom's `document-register-
        // element` compat shim enforces this strictly and throws
        // ("Failed to construct 'CustomElement': The result must not have
        // attributes") if violated. See the comment on `TERMINAL_ELEMENT_ATTRIBUTE`
        // above for what this is for.
        this.setAttribute(TERMINAL_ELEMENT_ATTRIBUTE, '');
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
            tslib.__classPrivateFieldSet(this, _TerminalElement_mainResizeObserver, new ResizeObserver((entries) => {
                let last = entries[entries.length - 1];
                tslib.__classPrivateFieldSet(this, _TerminalElement_mainContentRect, last.contentRect, "f");
                debouncedRefitTerminal();
            }), "f");
            tslib.__classPrivateFieldGet(this, _TerminalElement_mainResizeObserver, "f").observe(this.div.main);
            tslib.__classPrivateFieldSet(this, _TerminalElement_terminalIntersectionObserver, new IntersectionObserver(async (entries) => {
                let last = entries[entries.length - 1];
                if (last.intersectionRatio !== 1.0)
                    return;
                tslib.__classPrivateFieldSet(this, _TerminalElement_terminalInitiallyVisible, true, "f");
                try {
                    await this.createTerminal();
                    initializeResolve();
                }
                catch (error) {
                    initializeReject(error);
                }
                tslib.__classPrivateFieldGet(this, _TerminalElement_terminalIntersectionObserver, "f")?.disconnect();
                tslib.__classPrivateFieldSet(this, _TerminalElement_terminalIntersectionObserver, null, "f");
            }, {
                root: this,
                threshold: 1.0
            }), "f");
            tslib.__classPrivateFieldGet(this, _TerminalElement_terminalIntersectionObserver, "f").observe(this.div.terminal);
            this.subscriptions.add(new atom$1.Disposable(() => tslib.__classPrivateFieldGet(this, _TerminalElement_terminalIntersectionObserver, "f")?.disconnect()));
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
            }), atom.config.observe('terminal.behavior.prioritizedCommands', (newValue) => {
                tslib.__classPrivateFieldSet(this, _TerminalElement_prioritizedPrefixes, newValue, "f");
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
    activateLink(event, uri, _range) {
        if (config.Config.get('behavior.requireModifierToOpenUrls')) {
            let modifier = utils.isMac() ? event.metaKey : event.ctrlKey;
            if (!modifier) {
                // Users get warned the first time they try to click a link without
                // holding a modifier… but only the first time.
                this.optionallyWarnAboutModifierlessClick();
                return;
            }
        }
        if (!uri.startsWith('file:')) {
            // This is a URL, most likely. Hand it off to the system for opening in
            // the user's default browser.
            remote.shell.openExternal(uri);
            return;
        }
        // If we get this far, we're dealing with a file path. The way we respond
        // to various paths depends upon the user's configuration.
        const behavior = config.Config.get('behavior.hyperlinkPathBehavior');
        const openDirectoriesInPulsar = behavior === 'all-pulsar';
        const openFilesInPulsar = behavior === 'all-pulsar' ||
            behavior === 'dir-explorer-file-pulsar';
        // Convert the `file://` URL to the format expected by Node APIs.
        let linkPath;
        try {
            linkPath = url.fileURLToPath(uri);
        }
        catch (err) {
            console.warn('[terminal] Did not open malformed URI because it did not resolve to a path:', uri);
            return;
        }
        // Nonexistent file paths don't have anything to handle.
        if (!fs__default.default.existsSync(linkPath))
            return;
        // Decide what to do with this hyperlink based on configuration and
        // whether the link points to a file or a directory.
        let isDir = fs__default.default.lstatSync(linkPath).isDirectory();
        let shouldOpenInPulsar = isDir ? openDirectoriesInPulsar : openFilesInPulsar;
        if (shouldOpenInPulsar) {
            this.openInPulsar(uri, isDir);
        }
        else if (isDir) {
            // The behavior of `shell.openExternal` for a directory will open a
            // file explorer to the directory in question so the user can view its
            // contents.
            remote.shell.openExternal(uri);
        }
        else {
            // We want to open the file's parent directory in the file explorer and
            // select this specific file.
            remote.shell.showItemInFolder(linkPath);
        }
    }
    // Immediately create and display a tooltip over the given range that
    // contains the given URI.
    showHoverTooltip(range, uri, rangeType = 'buffer') {
        if (!this.terminal)
            return;
        // To create the decoration that serves as our tooltip anchor element,
        // we must first create a marker on the correct row. This marker is
        // placed relative to where the cursor is right now.
        //
        // This information is not a lot of fun to retrieve! And we must
        // account for scenarios where the cursor is off screen because we've
        // scrolled up in the viewport.
        let { 
        // This seems to correlate to the row offset that the cursor has
        // _if_ the viewport is scrolled all the way to the bottom.
        cursorY, 
        // This seems to correlate to how many lines are offscreen _if_ the
        // viewport is scrolled all the way to the bottom.
        baseY, viewportY } = this.terminal.buffer.active;
        // The meaning of `range.start.(y|x)` differs based on where the range
        // came from:
        //
        // * `IBufferRange` (OSC 8 links): 1-based index; absolute buffer
        //   position.
        // * `IViewportRange` (plain URLs via `WebLinksAddon`): 0-based index;
        //   relative to the current viewport's top row.
        //
        // `registerMarker`'s offset is always relative to the cursor's
        // absolute buffer position, so we have to convert into that target
        // space.
        let markerY;
        let x;
        if (rangeType === 'viewport') {
            markerY = range.start.y + viewportY - baseY - cursorY;
            x = range.start.x;
        }
        else {
            markerY = range.start.y - (cursorY + baseY) - 1;
            x = range.start.x - 1;
        }
        log.debug(`Placed marker on row:`, markerY, 'given range starting at', range.start.y, 'and cursorY', cursorY, 'and baseY', baseY);
        let marker = this.terminal.registerMarker(markerY);
        let decoration = this.terminal.registerDecoration({
            x,
            marker,
            width: range.end.y === range.start.y ? (range.end.x - range.start.x + 1) : 1
        });
        // XTerm's documentation _claims_ to skip the registration of
        // decorations when we're on the alt buffer (used by, e.g., `less` and
        // `vim` and `top` and anything else complex enough to need the concept
        // of a viewport and its own management of a scroll buffer).
        //
        // Yet it _does not_ actually skip in this scenario! This is good for
        // us; it would be a lot harder to deliver hover tooltips without this
        // mechanism. The only caveat is that it does unconditionally set
        // `display: none` on all alt-buffer decorations rather than attempt to
        // discern whether they're present in the viewport. (It would not
        // matter in our case; this whole code path is triggered when a user
        // mouses over a link, so we can assume that the link is present in the
        // viewport!)
        //
        // A reading of the source code and the design of the decoration system
        // suggests that this is a documentation bug rather than a code bug.
        // Nothing about this has changed in the XTerm 6.1.0 beta, and we
        // expect that it won't change in the future… but we do still guard
        // against a lack of decoration just in case!
        if (!decoration)
            return;
        this.tooltip = new atom$1.CompositeDisposable();
        this.tooltip.add(new atom$1.Disposable(() => {
            decoration?.dispose();
            marker?.dispose();
        }));
        let originalTooltip = this.tooltip;
        decoration.onRender((elem) => {
            if (!this.terminal)
                return;
            // Guard against an old decoration trying to render.
            if (this.tooltip !== originalTooltip)
                return;
            // Explicitly remove any `none` value for `display` for the reasons
            // described above. If XTerm thinks this decoration should be hidden,
            // it's almost certainly wrong.
            elem.style.display = '';
            // All tooltip management is manual. We don't want to rely on a belief that
            // `element` is being hovered by the mouse pointer (that's not safe to
            // assume when a decoration spans multiple lines), so it's better to opt
            // into `trigger: 'manual'` and have the tooltip appear instantly. The
            // tooltip will be hidden later on by disposing the return value of
            // `atom.tooltips.add` — which we do automatically.
            //
            // This is not a big problem! The only downside of manual triggering is
            // that we lose built-in management of show/hide delay — but that's where
            // `DelayedPresence` steps in.
            this.tooltip?.add(atom.tooltips.add(elem, {
                title: uri,
                trigger: 'manual'
            }));
        });
    }
    // Immediately hide the active tooltip.
    hideHoverTooltip(_range, _uri) {
        this.tooltip?.dispose();
        this.tooltipRange = undefined;
    }
    // Called when the user hovers over a link; schedules the showing of a
    // tooltip.
    hoverLink(_event, uri, range, rangeType = 'buffer') {
        if (!this.terminal || !range)
            return;
        this.tooltipRange = range;
        // Upon first hover, we're prone to trigger a `leave` and an almost
        // immediate `hover`. This might be the result of temporary confusion after
        // the empty anchor element is created and placed underneath the mouse
        // pointer.
        //
        // But whatever the cause, it means we're doing a sort of debouncing here.
        // If we're in the second of two rapid calls to `hover`, then there will be
        // an existing tooltip we want to preserve. This is why we have the
        // infrastructure of `DelayedPresence` — to detect this case and keep a
        // reliable state in our state machine.
        this.linkTooltip.enter({ range, uri, rangeType });
        // TODO: Ideally, we would prevent the link from being underlined on hover
        // _if_ configuration is such that a modifier key must be held down to open
        // a link. To do this in XTerm.js, we'd have to implement our own link
        // provider _instead of_ WebLinksAddon, so this is annoying.
        //
        // Even worse: that'd only work for URLs in the terminal, and not for OSC 8
        // hyperlinks (for which there is no easy way to accomplish this either).
    }
    // Called when the user mouses away from a link; schedules the hiding of the
    // tooltip.
    leaveLink(_event, uri, range) {
        // Ideally, we get called with a range; that lets us know whether this is
        // a fresh or stale request to hide the tooltip. But we'll fall back to the
        // current active tooltip range, if one exists.
        let operativeRange = range ?? this.tooltipRange;
        if (!operativeRange)
            return;
        // Trigger a delay-gated hiding of the tooltip. This will schedule the
        // hiding but cancel it if a mouseover happens again during the `hideDelay`
        // interval.
        this.linkTooltip.leave({ range: operativeRange, uri });
    }
    // Open the given URI within Pulsar.
    //
    // Exact behavior varies according to the user's configuration.
    async openInPulsar(uri, isDirectory = false) {
        let linkPath = url.fileURLToPath(uri);
        atom.project.contains(linkPath);
        if (isDirectory) ;
        else {
            // Whether the path within the project or outside of it, we'll open it
            // for editing in this window.
            await atom.workspace.open(linkPath);
        }
    }
    getModel() {
        return this.model;
    }
    destroy() {
        this.pty?.kill();
        tslib.__classPrivateFieldGet(this, _TerminalElement_instances, "m", _TerminalElement_loseWebglContext).call(this);
        this.terminal?.dispose();
        this.subscriptions.dispose();
    }
    getShellCommand() {
        return config.Config.get('terminal.shell');
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
        let fallbackEnvRaw = config.Config.get('terminal.env.fallbackEnv') ?? "{}";
        let overrideEnvRaw = config.Config.get('terminal.env.overrideEnv') ?? "{}";
        let deleteEnv = config.Config.get('terminal.env.deleteEnv') ?? [];
        let fallbackEnv = utils.parseEnvConfigValue(fallbackEnvRaw);
        let overrideEnv = utils.parseEnvConfigValue(overrideEnvRaw);
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
        return this.pty && tslib.__classPrivateFieldGet(this, _TerminalElement_ptyMeta, "f")?.running;
    }
    getExtraXTermOptions() {
        let rawValue = config.Config.get('xterm.additionalOptions');
        let result = {};
        if (rawValue) {
            try {
                result = JSON.parse(rawValue);
            }
            catch (err) {
                atom.notifications.addError('Terminal: Invalid configuration', {
                    description: `The value of **XTerm Configuration → Additional Options** is not valid JSON.`
                });
                result = {};
            }
        }
        return result;
    }
    getXtermOptions() {
        let xtermOptions = {
            cursorBlink: true,
            overviewRuler: {
                width: 15,
                showTopBorder: true,
                showBottomBorder: true,
            },
            ...this.getExtraXTermOptions()
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
    optionallyWarnAboutModifierlessClick() {
        if (!config.Config.get('advanced.warnAboutModifierWhenOpeningUrls')) {
            return;
        }
        config.Config.set('advanced.warnAboutModifierWhenOpeningUrls', false);
        atom.notifications.addInfo(`Terminal: Click ignored`, {
            description: `For security and protection against accidental clicks, you must hold <kbd>${utils.isMac() ? 'Cmd' : 'Ctrl'}</kbd> while clicking URLs in order to open them in your browser. You may disable this requirement in the package settings. (This message will be shown only once.)`,
            dismissable: true,
            buttons: [
                {
                    text: 'Open Terminal Settings',
                    onDidClick() {
                        atom.workspace.open(`atom://config/packages/${utils.PACKAGE_NAME}`);
                    }
                }
            ]
        });
    }
    async createTerminal() {
        if (this.createdPromise) {
            await this.createdPromise;
        }
        this.createdPromise = tslib.__classPrivateFieldGet(this, _TerminalElement_instances, "m", _TerminalElement_createTerminal).call(this);
        this.createdPromise.then(() => {
            this.createdPromise = undefined;
        });
        return await this.createdPromise;
    }
    async waitForShellEnvironment(timeoutMs = 5000) {
        let promise = new Promise((resolve) => {
            // This will invoke the callback immediately if the shell environment has
            // already been loaded, so it's easy to promisify.
            atom.whenShellEnvironmentLoaded(resolve);
        });
        if (timeoutMs > 0) {
            // TODO: We might want this not to error on timeout; we might want this
            // to just grow impatient and proceed, since it's not necessarily
            // catastrophic if the shell environment doesn't load.
            return await utils.timeout(promise, timeoutMs, { tag: 'waitForShellEnvironment' });
        }
        else {
            return await promise;
        }
    }
    updateTheme() {
        if (!this.terminal)
            return;
        let theme = themes.getTheme();
        this.setMainBackgroundColor(theme);
        this.terminal.options.theme = { ...theme };
    }
    async showFind(prefilledText) {
        if (!this.terminal || !this.findPalette)
            return false;
        await this.findPalette.show();
        if (prefilledText) {
            this.findPalette.search(prefilledText);
        }
        return true;
    }
    toggleFind() {
        if (!this.terminal || !this.findPalette)
            return false;
        this.findPalette.toggle();
        return true;
    }
    hideFind() {
        if (!this.terminal || !this.findPalette)
            return false;
        this.findPalette.hide();
        this.terminal?.focus();
        return true;
    }
    findNext() {
        if (!this.terminal || !this.findPalette)
            return false;
        this.findPalette.findNext();
        return true;
    }
    findPrevious() {
        if (!this.terminal || !this.findPalette)
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
        if (tslib.__classPrivateFieldGet(this, _TerminalElement_ptyMeta, "f")?.running) {
            this.pty?.removeAllListeners('exit');
            this.pty?.kill();
            tslib.__classPrivateFieldGet(this, _TerminalElement_ptyMeta, "f").running = false;
        }
        let cwd = await this.getCwd();
        this.terminal?.reset();
        tslib.__classPrivateFieldGet(this, _TerminalElement_ptyMeta, "f").options ??= {};
        tslib.__classPrivateFieldGet(this, _TerminalElement_ptyMeta, "f").command = this.getShellCommand();
        tslib.__classPrivateFieldGet(this, _TerminalElement_ptyMeta, "f").args = this.getArgs();
        let name = this.getTerminalType();
        let env = this.getEnv();
        let encoding = this.getEncoding();
        tslib.__classPrivateFieldGet(this, _TerminalElement_ptyMeta, "f").options = { name, cwd, env };
        if (encoding && tslib.__classPrivateFieldGet(this, _TerminalElement_ptyMeta, "f").options) {
            // Only set encoding if there's an actual encoding to set.
            tslib.__classPrivateFieldGet(this, _TerminalElement_ptyMeta, "f").options.encoding = encoding;
        }
        tslib.__classPrivateFieldGet(this, _TerminalElement_ptyMeta, "f").options.cols = this.pty?.cols;
        tslib.__classPrivateFieldGet(this, _TerminalElement_ptyMeta, "f").options.rows = this.pty?.rows;
        // Because we `await` after the we check for the presence of the PTY
        // earlier, we need to check again just to make sure.
        if (tslib.__classPrivateFieldGet(this, _TerminalElement_ptyMeta, "f")?.running || this.pty) {
            this.pty?.removeAllListeners('exit');
            this.pty?.kill();
            tslib.__classPrivateFieldGet(this, _TerminalElement_ptyMeta, "f").running = false;
        }
        this.pty = undefined;
        tslib.__classPrivateFieldGet(this, _TerminalElement_ptyMeta, "f").running = false;
        try {
            this.pty = new pty.Pty({
                file: tslib.__classPrivateFieldGet(this, _TerminalElement_ptyMeta, "f").command ?? '',
                args: tslib.__classPrivateFieldGet(this, _TerminalElement_ptyMeta, "f").args,
                options: tslib.__classPrivateFieldGet(this, _TerminalElement_ptyMeta, "f").options
            });
            this.uid = this.pty.id;
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
                this.pty.onExit((exitCode) => {
                    if (!this.terminal || !this.model) {
                        throw new Error('No terminal or model for incoming PTY data');
                    }
                    tslib.__classPrivateFieldGet(this, _TerminalElement_ptyMeta, "f").running = false;
                    if (!this.leaveOpenAfterExit()) {
                        this.model.exit();
                    }
                    else {
                        this.terminal.write(`[Exited with code ${exitCode}]`);
                    }
                });
                await this.pty.booted();
                tslib.__classPrivateFieldGet(this, _TerminalElement_ptyMeta, "f").running = true;
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
            let message = `Launching ‘${tslib.__classPrivateFieldGet(this, _TerminalElement_ptyMeta, "f").command}’ raised the following error: ${error.message}`;
            if (error.message.startsWith('File not found:')) {
                message = `Could not find command ‘${tslib.__classPrivateFieldGet(this, _TerminalElement_ptyMeta, "f").command}’.`;
            }
            this.showNotification(message, 'error', { force: true });
            this.pty = undefined;
            tslib.__classPrivateFieldGet(this, _TerminalElement_ptyMeta, "f").running = false;
        }
    }
    clear() {
        this.terminal?.clear();
    }
    sendSignal(signal) {
        if (!model.isSafeSignal(signal)) {
            console.warn('Invalid signal');
            return false;
        }
        if (!this.terminal) {
            console.warn('No terminal!');
            return false;
        }
        if (!this.pty) {
            console.warn('No PTY!');
            return false;
        }
        switch (signal) {
            case 'SIGTERM':
                this.destroy();
                return true;
            case 'SIGINT':
                this.pty.write('\x03');
                return true;
            case 'SIGQUIT':
                this.pty.write('\x1c');
                return true;
            default:
                return false;
        }
    }
    refitTerminal() {
        if (!this.terminal || !tslib.__classPrivateFieldGet(this, _TerminalElement_fitAddon, "f"))
            return;
        if (!tslib.__classPrivateFieldGet(this, _TerminalElement_terminalInitiallyVisible, "f")) {
            return;
        }
        if (!tslib.__classPrivateFieldGet(this, _TerminalElement_mainContentRect, "f")) {
            return;
        }
        if (tslib.__classPrivateFieldGet(this, _TerminalElement_mainContentRect, "f").height === 0 || tslib.__classPrivateFieldGet(this, _TerminalElement_mainContentRect, "f").width === 0) {
            return;
        }
        tslib.__classPrivateFieldGet(this, _TerminalElement_fitAddon, "f").fit();
        let geometry = tslib.__classPrivateFieldGet(this, _TerminalElement_fitAddon, "f").proposeDimensions();
        if (!geometry || !this.isPtyProcessRunning() || !this.pty) {
            return;
        }
        // We originally had this so that a call to `resize` didn't happen unless
        // the refit resulted in a change in geometry. But we seem to get better
        // results if we call this method redundantly!
        this.pty.resize(geometry.cols, geometry.rows);
        tslib.__classPrivateFieldGet(this, _TerminalElement_ptyMeta, "f").cols = geometry.cols;
        tslib.__classPrivateFieldGet(this, _TerminalElement_ptyMeta, "f").rows = geometry.rows;
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
    selectAll() {
        this.terminal?.selectAll();
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
    pointsAreEqual(a, b) {
        return a.x === b.x && a.y === b.y;
    }
    rangesAreEqual(a, b) {
        if (!a || !b)
            return a === b;
        return this.pointsAreEqual(a.start, b.start) && this.pointsAreEqual(a.end, b.end);
    }
    inspectPoint(cell) {
        return `(${cell.x}, ${cell.y})`;
    }
    inspectRange(range) {
        if (!range)
            return `(undefined)`;
        return `${this.inspectPoint(range.start)} - ${this.inspectPoint(range.end)}`;
    }
}
_TerminalElement_mainResizeObserver = new WeakMap(), _TerminalElement_mainContentRect = new WeakMap(), _TerminalElement_terminalIntersectionObserver = new WeakMap(), _TerminalElement_terminalInitiallyVisible = new WeakMap(), _TerminalElement_fitAddon = new WeakMap(), _TerminalElement_searchAddon = new WeakMap(), _TerminalElement_webglAddon = new WeakMap(), _TerminalElement_prioritizedPrefixes = new WeakMap(), _TerminalElement_ptyMeta = new WeakMap(), _TerminalElement_instances = new WeakSet(), _TerminalElement_loseWebglContext = function _TerminalElement_loseWebglContext() {
    let gl = tslib.__classPrivateFieldGet(this, _TerminalElement_webglAddon, "f")?._renderer?._gl;
    gl?.getExtension('WEBGL_lose_context')?.loseContext();
    tslib.__classPrivateFieldSet(this, _TerminalElement_webglAddon, null, "f");
}, _TerminalElement_shouldPrioritizeBinding = function _TerminalElement_shouldPrioritizeBinding(kb, ancestorChain) {
    let matchesPrioritizedPrefix = tslib.__classPrivateFieldGet(this, _TerminalElement_prioritizedPrefixes, "f").some(prefix => {
        if (prefix.endsWith(':'))
            return kb.command.startsWith(prefix);
        else
            return kb.command === prefix;
    });
    if (!matchesPrioritizedPrefix)
        return false;
    if (ancestorChain) {
        log.debug('Considering binding', kb, 'in the context of event target', ancestorChain[0], 'and full ancestor chain:', ancestorChain);
        // Weed out bindings that cannot apply within this DOM context. If this is
        // a valid binding for this context, our target (or one of its ancestors)
        // will match the given selector.
        //
        // Eventually, we won't need to do this manually, and will instead be able
        // to ask `atom.keymaps` for this information.
        if (!ancestorChain.some(node => node?.matches(kb.selector)))
            return false;
        log.log('Prioritizing binding for command', kb.command, 'because our DOM context matches the selector', kb.selector);
    }
    else {
        // We don't have the DOM context to help us make this decision, so we'll
        // let this through on the strength of the command prefix matching.
        log.log('Prioritizing binding for command', kb.command, 'because it matches our whitelist of command prefixes');
        return true;
    }
    return true;
}, _TerminalElement_keymapHasPendingPartialMatches = function _TerminalElement_keymapHasPendingPartialMatches() {
    // @ts-ignore Undocumented
    let partialMatches = atom.keymaps.pendingPartialMatches;
    if (!partialMatches)
        return false;
    return partialMatches.some((kb) => tslib.__classPrivateFieldGet(this, _TerminalElement_instances, "m", _TerminalElement_shouldPrioritizeBinding).call(this, kb));
}, _TerminalElement_keyboardEventMatchesKeybinding = function _TerminalElement_keyboardEventMatchesKeybinding(event) {
    let keystroke = atom.keymaps.keystrokeForKeyboardEvent(event);
    // The approach below finds candidates in isolation. This works well for
    // keybindings, but will not work for key sequences, since we're not
    // incorporating the `KeymapManager` state in this search. That's why the
    // approach in the function above still comes in handy.
    // @ts-ignore Undocumented.
    let bindings = atom.keymaps.findMatchCandidates([keystroke], []);
    log.debug('Looked for bindings that match', keystroke, 'and found candidates:', bindings);
    if (bindings.exactMatchCandidates.length === 0)
        return false;
    // The matching bindings have not yet been checked to see if they apply in
    // this DOM context. So we'll build a list of elements starting with the
    // target element, then moving upward in the tree and adding each of its
    // element ancestors. We do this here in order to prevent duplicated work.
    let target = event.target;
    if (!target)
        return false;
    let ancestorChain = [];
    let node = target;
    while (node && node.matches) {
        ancestorChain.push(node);
        if (node.parentNode === document)
            break;
        node = node.parentNode;
    }
    let result = bindings.exactMatchCandidates.some((kb) => tslib.__classPrivateFieldGet(this, _TerminalElement_instances, "m", _TerminalElement_shouldPrioritizeBinding).call(this, kb, ancestorChain));
    if (result) {
        log.log('Assuming control of keybinding:', keystroke, 'because it matches at least one Pulsar binding');
    }
    return result;
}, _TerminalElement_createTerminal = async function _TerminalElement_createTerminal() {
    this.setMainBackgroundColor();
    // We don't want to start a terminal until the shell environment has been
    // loaded. Otherwise the shell may not inherit the right environment
    // variables.
    //
    // Under normal circumstances, the package won't activate until that
    // happens anyway; but when we restore a project with open terminal
    // windows, the package will activate sooner than we'd ideally want. This
    // enforces that, even when `TerminalElement` is instantiated early, we
    // wait for the shell before proceeding.
    await this.waitForShellEnvironment();
    let options = {
        ...this.getXtermOptions(),
        allowProposedApi: true,
        linkHandler: this.linkHandler,
    };
    log.debug('Declaring new Terminal with options:', options);
    this.terminal = new xterm.Terminal(options);
    // TODO: Harmonize this with the custom key event handler below. This
    // approach is useful when the last key of a would-be key sequence is
    // swallowed by xterm.js.
    this.terminal.onKey((event) => {
        // Take keys that were already handled by xterm.js and handle them again
        // in Pulsar.
        //
        // It's hard to know exactly when to do this. If we _never_ do it,
        // certain keybindings just won't ever work when the terminal is fully
        // focused. If we _always_ do it, then every single keystroke the user
        // types in the terminal has the potential to both produce a character
        // (or action) in the terminal _and_ trigger a command in the workspace.
        //
        // Right now, we act very cautiously and only redispatch keyboard events
        // if we think that doing so might complete a pending match _related to
        // one of this package's commands_.
        if (tslib.__classPrivateFieldGet(this, _TerminalElement_instances, "m", _TerminalElement_keymapHasPendingPartialMatches).call(this)) {
            redispatchKeyboardEvent(event.domEvent, this);
        }
    });
    tslib.__classPrivateFieldSet(this, _TerminalElement_fitAddon, new addonFit.FitAddon(), "f");
    this.terminal.loadAddon(tslib.__classPrivateFieldGet(this, _TerminalElement_fitAddon, "f"));
    if (config.Config.get('xterm.webLinks')) {
        this.terminal.loadAddon(new addonWebLinks.WebLinksAddon(this.activateLink.bind(this), {
            hover: (event, text, location) => {
                this.linkHandler.hoverWithOptionalRange(event, text, location, 'viewport');
            },
            leave: this.linkHandler.leaveWithOptionalRange.bind(this.linkHandler)
        }));
    }
    if (this.div) {
        this.terminal.open(this.div.terminal);
    }
    if (config.Config.get('xterm.webgl')) {
        try {
            tslib.__classPrivateFieldSet(this, _TerminalElement_webglAddon, new addonWebgl.WebglAddon(), "f");
        }
        catch (err) {
            // The addon will throw on instantiation if a WebGL context cannot be
            // acquired.
            console.warn('terminal.xterm.webgl is true, but platform does not support WebGL');
        }
        if (tslib.__classPrivateFieldGet(this, _TerminalElement_webglAddon, "f")) {
            let webglAddon = tslib.__classPrivateFieldGet(this, _TerminalElement_webglAddon, "f");
            webglAddon.onContextLoss(() => webglAddon.dispose());
            this.terminal.loadAddon(webglAddon);
        }
    }
    if (config.Config.get('xterm.ligatures')) {
        this.terminal.loadAddon(new _addonLigatures.LigaturesAddon());
    }
    tslib.__classPrivateFieldSet(this, _TerminalElement_searchAddon, new addonSearch.SearchAddon(), "f");
    this.terminal.loadAddon(tslib.__classPrivateFieldGet(this, _TerminalElement_searchAddon, "f"));
    // Attach a key event handler so that we get dibs on handling a given key
    // event before the terminal itself.
    this.terminal.attachCustomKeyEventHandler((event) => {
        log.log('Inspecting key', event.key, 'with raw event:', event);
        const hasModifier = event.ctrlKey || event.altKey || event.metaKey;
        // Any event that would produce a character and does not have a
        // traditional modifier key should definitely be handled by the terminal.
        // This is an easy way to return quickly for the vast majority of key
        // events without even spending time consulting `KeymapManager`.
        if (!hasModifier && event.charCode) {
            log.debug('This is a simple keyboard event that will produce a character, so we’ll let xterm.js handle it without checking for bindings that match!');
            return true;
        }
        // Otherwise, let's see if this event would match any keybindings that
        // would trigger any commands defined by this package.
        if (tslib.__classPrivateFieldGet(this, _TerminalElement_instances, "m", _TerminalElement_keyboardEventMatchesKeybinding).call(this, event)) {
            // It does, so it's worth preempting xterm.js's own key handling and
            // allow this event to bubble so Pulsar can handle it.
            //
            // This means that a user can bind one of this package's commands to
            // (e.g.) `Ctrl+C` and shoot themselves in the foot, losing the ability
            // to send SIGINT. But that would be silly of them!
            log.warn('Bypassing xterm.js’s handling of this keyboard event!');
            return false;
        }
        // Everything that doesn't match any of this package's keybindings at
        // least gets a chance at being handled by xterm.js. Anything that fails
        // to get handled will bubble up and be handled by Pulsar anyway.
        return true;
    });
    this.findPalette = new findPalette(tslib.__classPrivateFieldGet(this, _TerminalElement_searchAddon, "f"));
    if (this.div) {
        this.div.palette.appendChild(this.findPalette.element);
    }
    tslib.__classPrivateFieldGet(this, _TerminalElement_ptyMeta, "f").cols = 80;
    tslib.__classPrivateFieldGet(this, _TerminalElement_ptyMeta, "f").rows = 25;
    this.refitTerminal();
    tslib.__classPrivateFieldGet(this, _TerminalElement_ptyMeta, "f").running = false;
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
};
// Deliberately not called at module-load time. This module gets `require`d
// as part of Pulsar's package *preload* step for any bundled package (see
// `Package.prototype.preload()` in Pulsar core), which happens unconditionally
// for whichever copy of this package Pulsar ships bundled — independent of
// whether a dev-linked copy is what actually ends up activated. Since
// `customElements.define()` can never be called twice for the same tag name,
// defining it eagerly here would let whichever copy happens to load first
// (not necessarily the one that's actually activated) permanently win the
// registration. Call this from the package's `activate()` instead, which
// only ever runs for the package that's genuinely in use.
function registerTerminalElement() {
    let name = utils.getElementName();
    if (customElements.get(name))
        return;
    customElements.define(name, TerminalElement);
}

exports.TERMINAL_ELEMENT_ATTRIBUTE = TERMINAL_ELEMENT_ATTRIBUTE;
exports.TerminalElement = TerminalElement;
exports.registerTerminalElement = registerTerminalElement;
//# sourceMappingURL=element.js.map
