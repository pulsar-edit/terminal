'use strict';

const TAG = `[terminal] `;
// In headless mode, point `warn` and `debug` to `console.log` so they'll show
// up in terminal output.
let _headless = undefined;
function isHeadless() {
    // @ts-ignore Undocumented setting.
    _headless ??= !!atom.getLoadSettings().headless;
    return _headless;
}
let enabled = false;
let subscription = undefined;
// Must be called at least once before logging can begin. If you're unsure,
// just call it; it's idempotent!
function initialize() {
    if (subscription)
        return;
    subscription = atom.config.observe('terminal.advanced.enableDebugLogging', (newValue) => {
        enabled = newValue;
    });
}
function destroy() {
    subscription?.dispose();
    subscription = undefined;
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
    if (isHeadless()) {
        console.log(...args);
    }
    else {
        console.warn(...args);
    }
}
function debug(...args) {
    if (!enabled)
        return;
    args.unshift(TAG);
    if (isHeadless()) {
        console.log(...args);
    }
    else {
        console.debug(...args);
    }
}
function error(...args) {
    if (!enabled)
        return;
    args.unshift(TAG);
    console.error(...args);
}

exports.debug = debug;
exports.destroy = destroy;
exports.error = error;
exports.initialize = initialize;
exports.log = log;
exports.warn = warn;
//# sourceMappingURL=log.js.map
