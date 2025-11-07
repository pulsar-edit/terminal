import { Config } from "./config";
import { TerminalModel } from "./model";

export function isWindows () {
  return process.platform === 'win32';
}

export function isMac () {
  return process.platform === 'darwin';
}

export function isLinux () {
  return process.platform === 'linux';
}


export function withResolvers<T extends unknown = void>(): {
  promise: Promise<T>,
  resolve: (value: T | PromiseLike<T>) => void,
  reject: (reason?: any) => void
} {
  let resolve: (value: T | PromiseLike<T>) => void;
  let reject: (reason?: any) => void;

  let promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });

  return { promise, resolve: resolve!, reject: reject! };
}


export function recalculateActive (terminals: Set<TerminalModel>, active: TerminalModel) {
  let terminalsList = Array.from(terminals);
  terminalsList.sort((a, b) => {
    if (active && a === active) return -1;
    if (active && b === active) return 1;

    if (a.isVisible() && !b.isVisible()) return -1;
    if (b.isVisible() && !a.isVisible()) return 1;

    return a.activeIndex - b.activeIndex;
  });

  for (let [index, term] of terminalsList.entries()) {
    term.setIndex(index);
  }
}


export function getCurrentCwd () {
  let useProjectRootAsCwd = Config.get('terminal.useProjectRootAsCwd');
  let fallbackCwd = Config.get('terminal.cwd');
  let [projectRoot] = atom.project.getPaths();
  if (!useProjectRootAsCwd) return fallbackCwd;
  return projectRoot ?? fallbackCwd;
}


export async function timeout(promise: Promise<unknown>, timeoutMs: number = 5000) {
  let rejectPromise = new Promise((_, reject) => {
    setTimeout(reject, timeoutMs, new Error(`Failed to resolve after ${timeoutMs} milliseconds`));
  });
  return Promise.race([promise, rejectPromise]);
}
