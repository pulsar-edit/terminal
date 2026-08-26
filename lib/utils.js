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
// Do our own keystroke humanization rather than depend on `underscore-plus`.
// Key names as they appear in a keystroke pattern, mapped to how we want to
// present them to a human. Modifiers and a handful of named keys share one map
// because both are matched before we consider anything else.
const MAC_KEY_MAP = {
    cmd: '⌘',
    ctrl: '⌃',
    alt: '⌥',
    option: '⌥',
    shift: '⇧',
    enter: '⏎',
    left: '←',
    right: '→',
    up: '↑',
    down: '↓'
};
const NON_MAC_KEY_MAP = {
    cmd: 'Cmd',
    ctrl: 'Ctrl',
    alt: 'Alt',
    option: 'Alt',
    shift: 'Shift',
    enter: 'Enter',
    left: 'Left',
    right: 'Right',
    up: 'Up',
    down: 'Down'
};
// Characters that can only be typed by holding `Shift`. Keymaps describe these
// by the character itself (`ctrl-~`), but humans think of them as a
// combination (`Ctrl+Shift+~`).
const SHIFTED_CHARACTERS = {
    '~': '`', '!': '1', '@': '2', '#': '3', '$': '4', '%': '5',
    '^': '6', '&': '7', '*': '8', '(': '9', ')': '0', '_': '-',
    '+': '=', '{': '[', '}': ']', '|': '\\', ':': ';', '"': "'",
    '<': ',', '>': '.', '?': '/'
};
// Converts a single key (one segment of a keystroke) into its human-facing
// form, returning an array because some keys imply a `Shift` modifier.
function humanizeKey(key, mac) {
    let keyMap = mac ? MAC_KEY_MAP : NON_MAC_KEY_MAP;
    if (key in keyMap)
        return [keyMap[key]];
    // A shifted character, or a capital letter — both imply `Shift`.
    if (key.length === 1 && key in SHIFTED_CHARACTERS) {
        return [keyMap.shift, SHIFTED_CHARACTERS[key]];
    }
    if (key.length === 1 && key === key.toUpperCase() && key.toUpperCase() !== key.toLowerCase()) {
        return [keyMap.shift, key.toUpperCase()];
    }
    if (key.length === 1 || /f[0-9]{1,2}/.test(key))
        return [key.toUpperCase()];
    // Some other named key we don't have an opinion about. On macOS these are
    // conventionally left alone; elsewhere we at least capitalize them.
    return mac ? [key] : [key[0].toUpperCase() + key.slice(1)];
}
// Converts a keystroke pattern from a keymap (`ctrl-shift-C`) into something
// suitable for showing to a user (`Ctrl+Shift+C`, or `⌃⇧C` on macOS).
//
// Handles multi-keystroke sequences (`ctrl-~ n`), which are returned
// space-separated just as they were given.
function humanizeKeystroke(keystroke, mac = isMac()) {
    if (!keystroke)
        return keystroke;
    return keystroke.split(' ').map(stroke => {
        let keys = [];
        let segments = stroke.split('-');
        for (let [index, segment] of segments.entries()) {
            // An empty segment means the key itself is `-`; the split leaves us with
            // two empties in a row, so we recover the hyphen on the second one.
            if (segment === '' && segments[index - 1] === '') {
                keys.push(...humanizeKey('-', mac));
            }
            else if (segment !== '') {
                keys.push(...humanizeKey(segment, mac));
            }
        }
        // `ctrl-shift-C` yields `Shift` twice — once from the modifier, once from
        // the capital letter.
        keys = [...new Set(keys)];
        return mac ? keys.join('') : keys.join('+');
    }).join(' ');
}
// Renders a keystroke pattern as a sequence of `<kbd>` elements, for use in
// notification descriptions.
function keystrokeToHTML(keystroke, mac = isMac()) {
    return humanizeKeystroke(keystroke, mac)
        .split(' ')
        .map(stroke => {
        let keys = mac ? [stroke] : stroke.split('+');
        return keys.map(key => `<kbd>${key}</kbd>`).join(mac ? '' : '+');
    })
        .join(' ');
}

exports.BASE_URI = BASE_URI;
exports.PACKAGE_NAME = PACKAGE_NAME;
exports.debounce = debounce;
exports.generateUri = generateUri;
exports.getCurrentCwd = getCurrentCwd;
exports.humanizeKeystroke = humanizeKeystroke;
exports.isMac = isMac;
exports.isWindows = isWindows;
exports.keystrokeToHTML = keystrokeToHTML;
exports.parseEnvConfigValue = parseEnvConfigValue;
exports.recalculateActive = recalculateActive;
exports.timeout = timeout;
exports.willUseConPTY = willUseConPTY;
exports.windowsBuildNumber = windowsBuildNumber;
//# sourceMappingURL=utils.js.map
