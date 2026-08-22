'use strict';

var os = require('os');
var config = require('./config.js');

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

var os__namespace = /*#__PURE__*/_interopNamespace(os);

function isWindows() {
    return process.platform === 'win32';
}
function isMac() {
    return process.platform === 'darwin';
}
function willUseConPTY() {
    // According to `node-pty`’s documentation, ConPTY will be used when the user
    // is on Windows 10 (1809) or greater, which corresponds to build 17763.
    if (!isWindows())
        return false;
    return (windowsBuildNumber() ?? 0) >= 17763;
}
function windowsBuildNumber() {
    if (!isWindows())
        return undefined;
    let versionSegments = os__namespace.release().split('.');
    let buildNumber = parseInt(versionSegments[versionSegments.length - 1], 10);
    return buildNumber;
}
const BASE_URI = `terminal://`;
const PACKAGE_NAME = 'terminal';
const DEFAULT_ELEMENT_NAME = 'pulsar-terminal';
let elementName;
/**
 * Picks (and memoizes) the tag name under which this package's custom element
 * gets registered.
 *
 * Prefers `pulsar-terminal`. Falls back to a randomized name if that tag is
 * already claimed by the time this is first called; this can happen whenever
 * this package is dev-linked over a Pulsar release that still ships an early
 * version of the `terminal` package (one that unconditionally registers
 * `pulsar-terminal` even before package activation).
 *
 * Pulsar's package preload step unconditionally `require()`s every bundled
 * package's main module (see `Package.prototype.preload()` in Pulsar core),
 * before dev-linked packages get resolution priority, so the bundled copy's
 * registration can win the tag before this build's own `activate()` ever runs.
 *
 * Since `customElements.define()` can only ever claim a given tag name once,
 * the only way to guarantee this build's element gets used is not to contest
 * that tag at all when it's already spoken for.
 *
 * Nothing but `registerTerminalElement()`/`TerminalElement.create()` (in
 * `element.ts`) should ever need to know the actual tag name. Everything else
 * that needs to find a terminal element (styles, keymaps, the context menu,
 * command scoping, `.closest()` lookups) should target
 * `TERMINAL_ELEMENT_ATTRIBUTE` instead, a stable marker the element sets on
 * itself in `initialize()` regardless of what it's tagged as.
 */
function getElementName() {
    if (elementName)
        return elementName;
    if (customElements.get(DEFAULT_ELEMENT_NAME)) {
        let suffix = crypto.randomUUID().replace(/-/g, '').slice(0, 6);
        elementName = `${DEFAULT_ELEMENT_NAME}-${suffix}`;
    }
    else {
        elementName = DEFAULT_ELEMENT_NAME;
    }
    return elementName;
}
function recalculateActive(terminals, active) {
    let allowHidden = config.Config.get('behavior.activeTerminalLogic') === 'all';
    let terminalsList = Array.from(terminals);
    terminalsList.sort((a, b) => {
        if (active && a === active)
            return -1;
        if (active && b === active)
            return 1;
        if (!allowHidden) {
            if (a.isVisible() && !b.isVisible())
                return -1;
            if (b.isVisible() && !a.isVisible())
                return 1;
        }
        return a.activeIndex - b.activeIndex;
    });
    for (let [index, term] of terminalsList.entries()) {
        term.setIndex(index);
    }
}
function getCurrentCwd() {
    let useProjectRootAsCwd = config.Config.get('terminal.useProjectRootAsCwd');
    let fallbackCwd = config.Config.get('terminal.cwd');
    let [projectRoot] = atom.project.getPaths();
    if (!useProjectRootAsCwd)
        return fallbackCwd;
    return projectRoot ?? fallbackCwd;
}
async function timeout(promise, timeoutMs = 5000, { tag = '' } = {}) {
    let rejectPromise = new Promise((_, reject) => {
        setTimeout(reject, timeoutMs, new Error(`${tag}: Failed to resolve after ${timeoutMs} milliseconds`));
    });
    return Promise.race([promise, rejectPromise]);
}
function debounce(callback, waitMs = 300) {
    let timeoutId;
    return (...args) => {
        clearTimeout(timeoutId);
        timeoutId = setTimeout(() => callback(...args), waitMs);
    };
}
function generateUri(params = {}) {
    let url = new URL(`${BASE_URI}${crypto.randomUUID()}/`);
    for (let [key, value] of Object.entries(params)) {
        url.searchParams.set(key, value);
    }
    return url.toString();
}
function parseEnvConfigValue(rawJson) {
    let result;
    try {
        result = JSON.parse(rawJson);
        return result;
    }
    catch (err) {
        return {};
    }
}

exports.BASE_URI = BASE_URI;
exports.DEFAULT_ELEMENT_NAME = DEFAULT_ELEMENT_NAME;
exports.PACKAGE_NAME = PACKAGE_NAME;
exports.debounce = debounce;
exports.generateUri = generateUri;
exports.getCurrentCwd = getCurrentCwd;
exports.getElementName = getElementName;
exports.isMac = isMac;
exports.isWindows = isWindows;
exports.parseEnvConfigValue = parseEnvConfigValue;
exports.recalculateActive = recalculateActive;
exports.timeout = timeout;
exports.willUseConPTY = willUseConPTY;
exports.windowsBuildNumber = windowsBuildNumber;
//# sourceMappingURL=utils.js.map
