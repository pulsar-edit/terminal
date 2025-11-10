'use strict';

var config = require('./config.js');

function isWindows() {
    return process.platform === 'win32';
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

exports.BASE_URI = BASE_URI;
exports.PACKAGE_NAME = PACKAGE_NAME;
exports.debounce = debounce;
exports.generateUri = generateUri;
exports.getCurrentCwd = getCurrentCwd;
exports.isWindows = isWindows;
exports.recalculateActive = recalculateActive;
exports.timeout = timeout;
//# sourceMappingURL=utils.js.map
