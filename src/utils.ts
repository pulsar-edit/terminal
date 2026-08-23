import * as os from 'os';
import * as path from 'path';

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

// Compiled to `lib/utils.js` (Rollup's `preserveModules` mirrors `src/`
// exactly — one file per module, and this one isn't nested any deeper than
// `src/utils.ts` is), so the package root — where `package.json` lives — is
// one level up from here. Reading the name from there instead of hardcoding
// it means this constant can never drift out of sync with the package's
// actual identity, whatever it's named at build time.
const PACKAGE_ROOT = path.normalize(path.join(__dirname, '..'));
const packageJson = require(path.join(PACKAGE_ROOT, 'package.json')) as { name: string };

export const PACKAGE_NAME = packageJson.name;
export const BASE_URI = `${PACKAGE_NAME}://`;

export const DEFAULT_ELEMENT_NAME = 'pulsar-terminal';

let elementName: string | undefined;

/**
 * Picks (and memoizes) the tag name under which this package's custom
 * element gets registered.
 *
 * Prefers `pulsar-terminal`. Falls back to a randomized name if that tag is
 * already claimed by the time this is first called — which happens whenever
 * this package is dev-linked over a Pulsar release that still ships its own
 * bundled `terminal` package: Pulsar's package *preload* step
 * unconditionally `require()`s every bundled package's main module (see
 * `Package.prototype.preload()` in Pulsar core), before dev-linked packages
 * get resolution priority, so the bundled copy's registration can win the
 * tag before this build's own `activate()` ever runs. Since
 * `customElements.define()` can only ever claim a given tag name once, the
 * only way to guarantee this build's element gets used is to not contest
 * that tag at all when it's already spoken for.
 *
 * Nothing but `registerTerminalElement()`/`TerminalElement.create()` (in
 * `element.ts`) should ever need to know the actual tag name — everything
 * else that needs to find a terminal element (styles, keymaps, the context
 * menu, command scoping, `.closest()` lookups, the e2e tests) should target
 * `TERMINAL_ELEMENT_ATTRIBUTE` instead, a stable marker the element sets on
 * itself in `initialize()` regardless of what it's tagged as.
 */
export function getElementName (): string {
  if (elementName) return elementName;
  if (customElements.get(DEFAULT_ELEMENT_NAME)) {
    let suffix = crypto.randomUUID().replace(/-/g, '').slice(0, 6);
    elementName = `${DEFAULT_ELEMENT_NAME}-${suffix}`;
  } else {
    elementName = DEFAULT_ELEMENT_NAME;
  }
  return elementName;
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

export function parseEnvConfigValue (rawJson: string) {
  let result: Record<string, string>;
  try {
    result = JSON.parse(rawJson);
    return result;
  } catch (err) {
    return {};
  }
}
