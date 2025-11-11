import * as os from 'os';

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

export function willUseConPTY () {
  // According to `node-pty`’s documentation, ConPTY will be used when the user
  // is on Windows 10 (1809) or greater, which corresponds to build 17763.
  if (!isWindows()) return false;
  return (windowsBuildNumber() ?? 0) >= 17763;
}

export function windowsBuildNumber (): number | undefined {
  if (!isWindows()) return undefined;
  let versionSegments = os.release().split('.');
  let buildNumber = parseInt(versionSegments[versionSegments.length - 1], 10);
  return buildNumber;
}

export const BASE_URI = `terminal://`;
export const PACKAGE_NAME = 'terminal';

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

export function recalculateActive (terminals: Set<TerminalModel>, active?: TerminalModel) {
  let allowHidden = Config.get('behavior.activeTerminalLogic') === 'all';
  let terminalsList = Array.from(terminals);
  terminalsList.sort((a, b) => {
    if (active && a === active) return -1;
    if (active && b === active) return 1;

    if (!allowHidden) {
      if (a.isVisible() && !b.isVisible()) return -1;
      if (b.isVisible() && !a.isVisible()) return 1;
    }

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


export async function timeout(
  promise: Promise<unknown>,
  timeoutMs: number = 5000,
  { tag = '' }: { tag?: string } = {}
) {
  let rejectPromise = new Promise((_, reject) => {
    setTimeout(reject, timeoutMs, new Error(`${tag}: Failed to resolve after ${timeoutMs} milliseconds`));
  });
  return Promise.race([promise, rejectPromise]);
}


export function debounce(
  callback: (...args: unknown[]) => void,
  waitMs: number = 300
) {
  let timeoutId: NodeJS.Timeout;
  return (...args: unknown[]) => {
    clearTimeout(timeoutId)
    timeoutId = setTimeout(() => callback(...args), waitMs);
  }
}

export function generateUri (params: Record<string, string> = {}) {
  let url = new URL(`${BASE_URI}${crypto.randomUUID()}/`);
  for (let [key, value] of Object.entries(params)) {
    url.searchParams.set(key, value);
  }
  return url.toString();
}
