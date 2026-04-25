import { Disposable } from 'atom';

const TAG = `[terminal] `;

let enabled = false;
let subscription: Disposable | undefined = undefined;

export function initialize () {
  subscription = atom.config.observe('terminal.advanced.enableDebugLogging', (newValue) => {
    enabled = newValue;
  });
}

export function destroy () {
  subscription?.dispose();
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
  console.debug(...args);
}
