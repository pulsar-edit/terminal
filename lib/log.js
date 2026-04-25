'use strict';

const TAG = `[terminal] `;
let enabled = false;
let subscription = undefined;
function initialize() {
    subscription = atom.config.observe('terminal.advanced.enableDebugLogging', (newValue) => {
        enabled = newValue;
    });
}
function destroy() {
    subscription?.dispose();
}
function log(...args) {
    if (!enabled)
        return;
    args.unshift(TAG);
    console.log(...args);
}
function warn(...args) {
    if (!enabled)
        return;
    args.unshift(TAG);
    console.warn(...args);
}
function debug(...args) {
    if (!enabled)
        return;
    args.unshift(TAG);
    console.debug(...args);
}

exports.debug = debug;
exports.destroy = destroy;
exports.initialize = initialize;
exports.log = log;
exports.warn = warn;
//# sourceMappingURL=log.js.map
