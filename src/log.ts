// A module that logs to the console if the `advanced.enableDebugLogging`
// setting is enabled.
import { Disposable } from 'atom';

const TAG = `[terminal] `;

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
  console.warn(...args);
}

export function debug (...args: unknown[]) {
  if (!enabled) return;
  args.unshift(TAG);
  console.debug(...args);
}

export function error (...args: unknown[]) {
  if (!enabled) return;
  args.unshift(TAG);
  console.error(...args);
}
