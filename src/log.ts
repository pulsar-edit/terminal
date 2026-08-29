// A module that logs to the console if the `advanced.enableDebugLogging`
// setting is enabled.
import { Disposable } from 'atom';

const TAG = `[terminal] `;

// In headless mode, point `warn` and `debug` to `console.log` so they'll show
// up in terminal output.
let _headless = undefined;
function isHeadless () {
  // @ts-ignore Undocumented setting.
  _headless ??= !!atom.getLoadSettings().headless;
  return _headless;
}

let enabled = false;
let subscription: Disposable | undefined = undefined;

// Must be called at least once before logging can begin. If you're unsure,
// just call it; it's idempotent!
export function initialize () {
  if (subscription) return;
  subscription = atom.config.observe('terminal.advanced.enableDebugLogging', (newValue) => {
    enabled = newValue;
  });
}

export function destroy () {
  subscription?.dispose();
  subscription = undefined;
}

export function log (...args: unknown[]) {
  if (!enabled) return;
  args.unshift(TAG);
  console.log(...args);
}

export function warn (...args: unknown[]) {
  if (!enabled) return;
  args.unshift(TAG);
  if (isHeadless()) {
    console.log(...args);
  } else {
    console.warn(...args);
  }
}

export function debug (...args: unknown[]) {
  if (!enabled) return;
  args.unshift(TAG);
  if (isHeadless()) {
    console.log(...args);
  } else {
    console.debug(...args);
  }
}

export function error (...args: unknown[]) {
  if (!enabled) return;
  args.unshift(TAG);
  console.error(...args);
}
