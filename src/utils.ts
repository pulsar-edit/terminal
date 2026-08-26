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

export function parseEnvConfigValue (rawJson: string) {
  let result: Record<string, string>;
  try {
    result = JSON.parse(rawJson);
    return result;
  } catch (err) {
    return {};
  }
}


// Do our own keystroke humanization rather than depend on `underscore-plus`.

// Key names as they appear in a keystroke pattern, mapped to how we want to
// present them to a human. Modifiers and a handful of named keys share one map
// because both are matched before we consider anything else.
const MAC_KEY_MAP: Record<string, string> = {
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

const NON_MAC_KEY_MAP: Record<string, string> = {
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
const SHIFTED_CHARACTERS: Record<string, string> = {
  '~': '`', '!': '1', '@': '2', '#': '3', '$': '4', '%': '5',
  '^': '6', '&': '7', '*': '8', '(': '9', ')': '0', '_': '-',
  '+': '=', '{': '[', '}': ']', '|': '\\', ':': ';', '"': "'",
  '<': ',', '>': '.', '?': '/'
};

// Converts a single key (one segment of a keystroke) into its human-facing
// form, returning an array because some keys imply a `Shift` modifier.
function humanizeKey (key: string, mac: boolean): string[] {
  let keyMap = mac ? MAC_KEY_MAP : NON_MAC_KEY_MAP;
  if (key in keyMap) return [keyMap[key]];

  // A shifted character, or a capital letter — both imply `Shift`.
  if (key.length === 1 && key in SHIFTED_CHARACTERS) {
    return [keyMap.shift, SHIFTED_CHARACTERS[key]];
  }
  if (key.length === 1 && key === key.toUpperCase() && key.toUpperCase() !== key.toLowerCase()) {
    return [keyMap.shift, key.toUpperCase()];
  }

  if (key.length === 1 || /f[0-9]{1,2}/.test(key)) return [key.toUpperCase()];

  // Some other named key we don't have an opinion about. On macOS these are
  // conventionally left alone; elsewhere we at least capitalize them.
  return mac ? [key] : [key[0].toUpperCase() + key.slice(1)];
}

// Converts a keystroke pattern from a keymap (`ctrl-shift-C`) into something
// suitable for showing to a user (`Ctrl+Shift+C`, or `⌃⇧C` on macOS).
//
// Handles multi-keystroke sequences (`ctrl-~ n`), which are returned
// space-separated just as they were given.
export function humanizeKeystroke (keystroke: string, mac: boolean = isMac()): string {
  if (!keystroke) return keystroke;

  return keystroke.split(' ').map(stroke => {
    let keys: string[] = [];
    let segments = stroke.split('-');

    for (let [index, segment] of segments.entries()) {
      // An empty segment means the key itself is `-`; the split leaves us with
      // two empties in a row, so we recover the hyphen on the second one.
      if (segment === '' && segments[index - 1] === '') {
        keys.push(...humanizeKey('-', mac));
      } else if (segment !== '') {
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
export function keystrokeToHTML (keystroke: string, mac: boolean = isMac()): string {
  return humanizeKeystroke(keystroke, mac)
    .split(' ')
    .map(stroke => {
      let keys = mac ? [stroke] : stroke.split('+');
      return keys.map(key => `<kbd>${key}</kbd>`).join(mac ? '' : '+');
    })
    .join(' ');
}
