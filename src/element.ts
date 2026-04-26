import fs from 'fs-extra';

import { CompositeDisposable, Disposable, KeyBinding } from 'atom';
import { isSafeSignal, Signal, TerminalModel } from './model';
import { Config } from './config';
import * as Logger from './log';

import { ITerminalOptions, ITheme, Terminal as XTerminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { WebLinksAddon } from '@xterm/addon-web-links';
import { WebglAddon } from '@xterm/addon-webgl';
import { LigaturesAddon } from '@xterm/addon-ligatures';
import { SearchAddon } from '@xterm/addon-search';

import FindPalette from './find-palette';

import { Pty } from './pty';
import { IPtyForkOptions, IWindowsPtyForkOptions } from 'node-pty';

import {
  debounce,
  isMac,
  isWindows,
  PACKAGE_NAME,
  parseEnvConfigValue,
  timeout,
  willUseConPTY,
  windowsBuildNumber
} from './utils';
import { getTheme } from './themes';

// TODO: Right now we're using `@electron/remote` as an explicit dependency;
// but when this becomes a builtin package, `@electron/remote` will be
// ambiently available. Better to use that without declaring it so as to avoid
// version clashes.
import { shell } from '@electron/remote';

// Given a line height and a font size, attempts to adjust the line height so
// that it results in a pixel height that snaps to the nearest pixel (or
// sub-pixel, taking device pixel ratio into account).
//
// In theory, this would be needed for synchronization with Pulsar, since the
// editor code does something similar. In practice, though, line height values
// seem to be applied differently in XTerm; a shared line-height value between
// the editor and the terminal window results in much taller lines in the
// terminal.
function clampLineHeight (lineHeight: number, fontSize: number) {
  let lineHeightInPx = fontSize * lineHeight;
  let roundedScaledLineHeightInPx = Math.round(lineHeightInPx * window.devicePixelRatio);
  return roundedScaledLineHeightInPx / (fontSize * window.devicePixelRatio);
}

const SUPPORTED_PREFIXES = [
  'terminal:',
  'pane:'
];

// Decides whether a given binding should be prioritized over a hypothetical
// binding within the terminal for the same key event.
//
// This is a heuristic. We don't want to privilege _all_ keybindings!
function shouldPrioritizeBinding (kb: KeyBinding, ancestorChain?: HTMLElement[]) {
  // For now, until we can better predict which binding will claim a given key
  // event, we'll maintain a whitelist of allowed command prefixes. Otherwise
  // we end up being far too aggressive — e.g., always claiming `Enter` because
  // it's bound to `core:confirm`.
  if (!SUPPORTED_PREFIXES.some(prefix => kb.command.startsWith(prefix))) {
    return;
  }
  if (ancestorChain) {
    Logger.debug('Considering binding', kb, 'in the context of event target', ancestorChain[0], 'and full ancestor chain:', ancestorChain);

    // Weed out bindings that cannot apply within this DOM context. If this is
    // a valid binding for this context, our target (or one of its ancestors)
    // will match the given selector.
    //
    // Eventually, we won't need to do this manually, and will instead be able
    // to ask `atom.keymaps` for this information.
    if (!ancestorChain.some(node => node?.matches(kb.selector))) return false;

    Logger.log('Prioritizing binding for command', kb.command, 'because our DOM context matches the selector', kb.selector);
  } else {
    // We don't have the DOM context to help us make this decision, so we'll
    // let this through on the strength of the command prefix matching.
    Logger.log('Prioritizing binding for command', kb.command, 'because it matches our whitelist of command prefixes');
    return true;
  }

  return true;
}

// Returns `true` if, at the current moment, Pulsar’s `KeymapManager` has at
// least one pending keybinding that belongs to one of this package's commands.
//
// We use this to decide whether we should re-propagate a keyboard event that
// xterm.js already swallowed. If we don't do this, `KeymapManager` gets
// confused, especially since it'll still receive the `keyup` event for the key
// the user just pressed.
//
// TODO: This might make sense to apply universally, not just where `terminal:`
// commands are involved. But this is a cautious first step.
function keymapHasPendingPartialMatches () {
  // @ts-ignore Undocumented
  let partialMatches: KeyBinding[] | null = atom.keymaps.pendingPartialMatches;
  if (!partialMatches) return false;
  return partialMatches.some((kb) => shouldPrioritizeBinding(kb));
}

// Returns `true` if the given keyboard event matches at least one key binding
// for this package.
//
// This is a heuristic that allows for certain exceptions to xterm.js's
// aggressive management of keyboard events. Lots of keybindings have some sort
// of obscure effect in a PTY, and that vastly constrains the set of bindings
// that can reliably be used to bind to Pulsar commands when the terminal has
// focus. The way out of that is to register a custom keyboard handler so that
// we get first dibs on handling any keyboard event.
//
// But that also means we've got to do the work to decide if a given keyboard
// event _would_ trigger a Pulsar keybinding… without actually triggering the
// key binding!
//
// Ideally, more of this work will one day be performed by the `KeymapManager`
// instance at `atom.keymaps` — which would more easily let us give Pulsar
// keybindings _in general_ precedence over terminal bindings. But this is
// enough to get us past the issue of this package not even being able to
// trigger _some of its own commands_ when the terminal has focus.
function keyboardEventMatchesKeybinding (event: KeyboardEvent) {
  let keystroke = atom.keymaps.keystrokeForKeyboardEvent(event);

  // The approach below finds candidates in isolation. This works well for
  // keybindings, but will not work for key sequences, since we're not
  // incorporating the `KeymapManager` state in this search. That's why the
  // approach in the function above still comes in handy.
  // @ts-ignore Undocumented.
  let bindings = atom.keymaps.findMatchCandidates([keystroke], []);
  Logger.debug('Looked for bindings that match', keystroke, 'and found candidates:', bindings);

  if (bindings.exactMatchCandidates.length === 0) return false;

  // The matching bindings have not yet been checked to see if they apply in
  // this DOM context. So we'll build a list of elements starting with the
  // target element, then moving upward in the tree and adding each of its
  // element ancestors. We do this here in order to prevent duplicated work.
  let target = event.target as HTMLElement | null;
  if (!target) return false;

  let ancestorChain: HTMLElement[] = [];
  let node: HTMLElement | null = target;
  while (node && node.matches) {
    ancestorChain.push(node);
    if (node.parentNode === document) break;
    node = node.parentNode as HTMLElement | null;
  }

  let result = bindings.exactMatchCandidates.some((kb: KeyBinding) => shouldPrioritizeBinding(kb, ancestorChain));

  if (result) {
    Logger.log('Assuming control of keybinding:', keystroke, 'because it matches at least one Pulsar binding');
  }
  return result;
}

// Takes a DOM `KeyboardEvent` whose default was already prevented and creates
// a fresh event so we can re-propagate it upward. This allows certain key
// bindings and key sequences to keep working even if some of their events are
// swallowed by xterm.js.
function redispatchKeyboardEvent(originalEvent: KeyboardEvent, targetElement: EventTarget) {
  let newEvent = new KeyboardEvent(originalEvent.type, {
    bubbles: true,
    cancelable: true,
    key: originalEvent.key,
    code: originalEvent.code,
    location: originalEvent.location,
    ctrlKey: originalEvent.ctrlKey,
    shiftKey: originalEvent.shiftKey,
    altKey: originalEvent.altKey,
    metaKey: originalEvent.metaKey,
    repeat: originalEvent.repeat,
    isComposing: originalEvent.isComposing
  });

  targetElement.dispatchEvent(newEvent);
}

export class TerminalElement extends HTMLElement {
  public model?: TerminalModel;
  public terminal?: XTerminal;
  public pty?: Pty;
  public initialized: boolean = false;
  public uid: number | undefined = undefined;

  private subscriptions = new CompositeDisposable();
  private initializedPromise?: Promise<void>;
  private createdPromise?: Promise<void>;
  private findPalette?: FindPalette;

  // Object that holds the various elements.
  private div?: Record<'top' | 'main' | 'menu' | 'terminal' | 'palette', HTMLDivElement>;

  #mainResizeObserver?: ResizeObserver;
  #mainContentRect?: DOMRectReadOnly;
  #terminalIntersectionObserver?: IntersectionObserver | null;
  #terminalInitiallyVisible: boolean = false;
  #fitAddon?: FitAddon;
  #searchAddon?: SearchAddon;

  // Metadata about the PTY.
  #ptyMeta: Partial<{
    command?: string;
    args?: string[];
    rows: number;
    cols: number;
    running: boolean;
    options: IPtyForkOptions | IWindowsPtyForkOptions
  }> = {};

  static create () {
    return document.createElement('pulsar-terminal') as TerminalElement;
  }

  async initialize (model: TerminalModel) {
    this.model = model;
    this.model.setElement(this);

    this.div = {
      top: document.createElement('div'),
      main: document.createElement('div'),
      menu: document.createElement('div'),
      terminal: document.createElement('div'),
      palette: document.createElement('div')
    };

    this.div.top.classList.add('terminal__top');
    this.div.main.classList.add('terminal__main');
    this.div.palette.classList.add('terminal__palette');
    this.div.menu.classList.add('terminal__menu');
    this.div.terminal.classList.add('terminal__terminal');
    this.div.main.appendChild(this.div.terminal);

    this.appendChild(this.div.top);
    this.appendChild(this.div.palette);
    this.appendChild(this.div.main);

    let initializeResolve: (value: void | PromiseLike<void>) => void;
    let initializeReject: (reason?: any) => void;
    this.initializedPromise = new Promise<void>((resolve, reject) => {
      initializeResolve = resolve;
      initializeReject = reject;
    });

    try {
      await this.model.ready();
      this.setAttribute('session-id', this.model.getSessionId());

      let debouncedRefitTerminal = debounce(() => this.refitTerminal());

      this.#mainResizeObserver = new ResizeObserver((entries) => {
        let last = entries[entries.length - 1];
        this.#mainContentRect = last.contentRect;
        debouncedRefitTerminal();
      });
      this.#mainResizeObserver.observe(this.div.main);

      this.#terminalIntersectionObserver = new IntersectionObserver(
        async (entries) => {
          let last = entries[entries.length - 1];

          if (last.intersectionRatio !== 1.0) return;
          this.#terminalInitiallyVisible = true;
          try {
            await this.createTerminal();
            initializeResolve();
          } catch (error) {
            initializeReject(error);
          }

          this.#terminalIntersectionObserver?.disconnect();
          this.#terminalIntersectionObserver = null;
        },
        {
          root: this,
          threshold: 1.0
        }
      );
      this.#terminalIntersectionObserver.observe(this.div.terminal);
      this.subscriptions.add(
        new Disposable(() => this.#terminalIntersectionObserver?.disconnect())
      );

      this.subscriptions.add(
        // Immediately apply new `fontSize` values when appropriate.
        atom.config.onDidChange(
          'editor.fontSize',
          ({ newValue }) => {
            if (!Config.get('appearance.useEditorFontSize')) return;
            if (!this.terminal) return;
            this.terminal.options.fontSize = newValue;
            this.refitTerminal();
          }
        ),
        atom.config.onDidChange(
          'terminal.appearance.fontSize',
          ({ newValue }) => {
            if (Config.get('appearance.useEditorFontSize')) return;
            if (!this.terminal) return;
            this.terminal.options.fontSize = newValue;
            this.refitTerminal();
          }
        )
      );

      // Increase or decrease the font size when holding `Ctrl` and moving the
      // mouse wheel up/down.
      // TODO: Do we need this?
      // this.div.terminal.addEventListener(
      //   'wheel',
      //   (event) => {
      //     if (!event.ctrlKey) return;
      //     if (!atom.config.get('editor.zoomFontWhenCtrlScrolling')) return;
      //     let fontSizeSchema = atom.config.getSchema('terminal.appearance.fontSize');
      //     event.stopPropagation();
      //
      //     let delta = event.deltaY < 0 ? 1 : -1;
      //     let fontSize = Config.get('appearance.fontSize') + delta;
      //     if (fontSize < fontSizeSchema.minimum) {
      //       fontSize = fontSizeSchema.minimum;
      //     } else if (fontSize > fontSizeSchema.maximum) {
      //       fontSize = fontSizeSchema.maximum;
      //     }
      //     Config.set('appearance.fontSize', fontSize);
      //   },
      //   { capture: true }
      // );
    } catch (error) {
      initializeReject!(error);
      throw error;
    }
    this.initialized = true;
  }

  // Awaits initialization of the terminal. Resolves when a terminal is ready
  // to accept text.
  async ready () {
    return await this.initializedPromise;
  }

  getModel () {
    return this.model;
  }

  destroy () {
    this.pty?.kill();
    this.terminal?.dispose();
    this.subscriptions.dispose();
  }

  getShellCommand () {
    return Config.get('terminal.shell');
  }

  getArgs () {
    let args = Config.get('terminal.args');
    if (!Array.isArray(args)) {
      throw new Error('Arguments must be an array');
    }
    return args;
  }

  getTerminalType () {
    return Config.get('terminal.terminalType');
  }

  // Ensures the given path exists and points to a valid directory on disk.
  async pathIsDirectory (filePath: string | undefined | null) {
    if (!filePath) return false;
    try {
      const stats = await fs.stat(filePath);
      if (stats?.isDirectory()) return true;
    } catch (err) {
      return false;
    }
    return false;
  }

  // Determines the proper `cwd` for this shell.
  async getCwd () {
    if (!this.model) return;
    let cwd = this.model.cwd;

    if (await this.pathIsDirectory(cwd)) {
      return cwd;
    }

    cwd = this.model.getPath();
    if (await this.pathIsDirectory(cwd)) {
      return cwd;
    }

    // If we get this far, the `cwd` on the model is invalid!
    if (this.model) {
      this.model.cwd = undefined;
    }

    return undefined;
  }

  getEnv () {
    let env: Record<string, string> = {};

    let fallbackEnvRaw = Config.get('terminal.env.fallbackEnv') ?? "{}";
    let overrideEnvRaw = Config.get('terminal.env.overrideEnv') ?? "{}";
    let deleteEnv = Config.get('terminal.env.deleteEnv') ?? [];

    let fallbackEnv = parseEnvConfigValue(fallbackEnvRaw);
    let overrideEnv = parseEnvConfigValue(overrideEnvRaw);

    // First copy over the fallbacks…
    Object.assign(env, fallbackEnv);
    // …then whatever we inherited from `process.env`…
    Object.assign(env, { ...process.env });
    // …then whatever we're overriding.
    Object.assign(env, overrideEnv);

    // Then delete any that shouldn't be there.
    for (let key of deleteEnv) {
      delete env[key];
    }
    return env;
  }

  getEncoding () {
    return Config.get('terminal.encoding') ?? 'utf8';
  }

  leaveOpenAfterExit () {
    return Config.get('behavior.leaveOpenAfterExit');
  }

  isPtyProcessRunning () {
    return this.pty && this.#ptyMeta?.running;
  }

  getExtraXTermOptions () {
    let rawValue = Config.get('xterm.additionalOptions');
    let result: Record<string, unknown> = {};
    if (rawValue) {
      try {
        result = JSON.parse(rawValue);
      } catch (err) {
        atom.notifications.addError('Terminal: Invalid configuration', {
          description: `The value of **XTerm Configuration → Additional Options** is not valid JSON.`
        });
        result = {};
      }
    }
    return result as Partial<ITerminalOptions>;
  }

  getXtermOptions () {
    let xtermOptions: ITerminalOptions = {
      cursorBlink: true,
      ...this.getExtraXTermOptions()
    };
    let fontFamilyKey = Config.get('appearance.useEditorFontFamily') ?
      'editor.fontFamily' : 'terminal.appearance.fontFamily';
    let fontSizeKey = Config.get('appearance.useEditorFontSize') ?
      'editor.fontSize' : 'terminal.appearance.fontSize';
    let lineHeightKey = Config.get('appearance.useEditorLineHeight') ?
      'editor.lineHeight' : 'terminal.appearance.lineHeight';

    xtermOptions.fontFamily = atom.config.get(fontFamilyKey);
    xtermOptions.fontSize = atom.config.get(fontSizeKey);
    let originalLineHeight = atom.config.get(lineHeightKey);
    if (xtermOptions.fontSize) {
      let adjustedLineHeight = clampLineHeight(originalLineHeight, xtermOptions.fontSize);
      xtermOptions.lineHeight = adjustedLineHeight;
    }
    xtermOptions.theme = getTheme();

    if (isWindows()) {
      xtermOptions.windowsPty = {
        backend: willUseConPTY() ? 'conpty' : 'winpty',
        buildNumber: windowsBuildNumber()
      };
    }

    return structuredClone(xtermOptions);
  }

  setMainBackgroundColor (theme: ITheme = getTheme()) {
    this.style.backgroundColor = theme?.background ?? '#000000';
  }

  optionallyWarnAboutModifierlessClick () {
    if (!Config.get('advanced.warnAboutModifierWhenOpeningUrls')) {
      return;
    }
    Config.set('advanced.warnAboutModifierWhenOpeningUrls', false);
    atom.notifications.addInfo(`Terminal: Click ignored`, {
      description: `For security and protection against accidental clicks, you must hold <kbd>${isMac() ? 'Cmd' : 'Ctrl'}</kbd> while clicking URLs in order to open them in your browser. You may disable this requirement in the package settings. (This message will be shown only once.)`,
      dismissable: true,
      buttons: [
        {
          text: 'Open Terminal Settings',
          onDidClick () {
            atom.workspace.open(`atom://config/packages/${PACKAGE_NAME}`);
          }
        }
      ]
    });
  }

  async createTerminal () {
    if (this.createdPromise) {
      await this.createdPromise;
    }
    this.createdPromise = this.#createTerminal();
    this.createdPromise.then(() => {
      this.createdPromise = undefined;
    });
    return await this.createdPromise;
  }

  async #createTerminal () {
    this.setMainBackgroundColor();

    // We don't want to start a terminal until the shell environment has been
    // loaded. Otherwise the shell may not inherit the right environment
    // variables.
    //
    // Under normal circumstances, the package won't activate until that
    // happens anyway; but when we restore a project with open terminal
    // windows, the package will activate sooner than we'd ideally want. This
    // enforces that, even when `TerminalElement` is instantiated early, we
    // wait for the shell before proceeding.
    await this.waitForShellEnvironment();

    this.terminal = new XTerminal({
      allowProposedApi: true,
      ...this.getXtermOptions()
    });

    // TODO: Harmonize this with the custom key event handler below. This
    // approach is useful when the last key of a would-be key sequence is
    // swallowed by xterm.js.
    this.terminal.onKey((event) => {
      // Take keys that were already handled by xterm.js and handle them again
      // in Pulsar.
      //
      // It's hard to know exactly when to do this. If we _never_ do it,
      // certain keybindings just won't ever work when the terminal is fully
      // focused. If we _always_ do it, then every single keystroke the user
      // types in the terminal has the potential to both produce a character
      // (or action) in the terminal _and_ trigger a command in the workspace.
      //
      // Right now, we act very cautiously and only redispatch keyboard events
      // if we think that doing so might complete a pending match _related to
      // one of this package's commands_.
      if (keymapHasPendingPartialMatches()) {
        redispatchKeyboardEvent(event.domEvent, this);
      }
    });

    this.#fitAddon = new FitAddon();
    this.terminal.loadAddon(this.#fitAddon);

    if (Config.get('xterm.webLinks')) {
      this.terminal.loadAddon(
        new WebLinksAddon(
          (event, uri) => {
            if (Config.get('behavior.requireModifierToOpenUrls')) {
              let modifier = isMac() ? event.metaKey : event.ctrlKey;
              if (!modifier) {
                this.optionallyWarnAboutModifierlessClick();
                return;
              }
            }
            shell.openExternal(uri);
          }
        )
      );
    }

    if (this.div) {
      this.terminal.open(this.div.terminal);
    }

    if (Config.get('xterm.webgl')) {
      this.terminal.loadAddon(new WebglAddon());
    }

    this.terminal.loadAddon(new LigaturesAddon());

    this.#searchAddon = new SearchAddon();
    this.terminal.loadAddon(this.#searchAddon);

    // Attach a key event handler so that we get dibs on handling a given key
    // event before the terminal itself.
    this.terminal.attachCustomKeyEventHandler((event) => {
      Logger.log('Inspecting key', event.key, 'with raw event:', event);
      const hasModifier = event.ctrlKey || event.altKey || event.metaKey;

      // Any event that would produce a character and does not have a
      // traditional modifier key should definitely be handled by the terminal.
      // This is an easy way to return quickly for the vast majority of key
      // events without even spending time consulting `KeymapManager`.
      if (!hasModifier && event.charCode) {
        Logger.debug('This is a simple keyboard event that will produce a character, so we’ll let xterm.js handle it without checking for bindings that match!');
        return true;
      }

      // Otherwise, let's see if this event would match any keybindings that
      // would trigger any commands defined by this package.
      if (keyboardEventMatchesKeybinding(event)) {
        // It does, so it's worth preempting xterm.js's own key handling and
        // allow this event to bubble so Pulsar can handle it.
        //
        // This means that a user can bind one of this package's commands to
        // (e.g.) `Ctrl+C` and shoot themselves in the foot, losing the ability
        // to send SIGINT. But that would be silly of them!
        Logger.warn('Bypassing xterm.js’s handling of this keyboard event!');
        return false;
      }

      // Everything that doesn't match any of this package's keybindings at
      // least gets a chance at being handled by xterm.js. Anything that fails
      // to get handled will bubble up and be handled by Pulsar anyway.
      return true;
    });

    this.findPalette = new FindPalette(this.#searchAddon);

    if (this.div) {
      this.div.palette.appendChild(this.findPalette.element);
    }

    this.#ptyMeta.cols = 80;
    this.#ptyMeta.rows = 25;

    this.refitTerminal();

    this.#ptyMeta.running = false;

    this.subscriptions.add(
      // When the terminal receives input, send it to the PTY.
      this.terminal.onData((data) => {
        if (this.isPtyProcessRunning()) {
          this.pty!.write(data);
        }
      }),

      // When the user selects text, we might want to automatically copy it to
      // the clipboard.
      this.terminal.onSelectionChange(() => {
        if (!this.terminal) return;
        if (!Config.get('behavior.copyTextOnSelect')) return;

        let text = this.terminal.getSelection();
        if (!text) return;

        let rawLines = text.split(/\r?\n/g);
        let lines = rawLines.map(line => line.replace(/\s/g, ' ').trimRight());
        text = lines.join('\n');
        atom.clipboard.write(text);
      })
    );

    await this.restartPtyProcess();
  }

  async waitForShellEnvironment (timeoutMs: number = 5000) {
    let promise = new Promise<void>((resolve) => {
      // This will invoke the callback immediately if the shell environment has
      // already been loaded, so it's easy to promisify.
      atom.whenShellEnvironmentLoaded(resolve);
    });
    if (timeoutMs > 0) {
      // TODO: We might want this not to error on timeout; we might want this
      // to just grow impatient and proceed, since it's not necessarily
      // catastrophic if the shell environment doesn't load.
      return await timeout(promise, timeoutMs, { tag: 'waitForShellEnvironment' });
    } else {
      return await promise;
    }
  }

  updateTheme () {
    if (!this.terminal) return;
    let theme = getTheme();
    this.setMainBackgroundColor(theme);
    this.terminal.options.theme = { ...theme };
  }

  async showFind (prefilledText?: string) {
    if (!this.terminal || !this.findPalette) return false;
    await this.findPalette.show();
    if (prefilledText) {
      this.findPalette.search(prefilledText);
    }
    return true;
  }

  toggleFind () {
    if (!this.terminal || !this.findPalette) return false;
    this.findPalette.toggle();
    return true;
  }

  hideFind () {
    if (!this.terminal || !this.findPalette) return false;
    this.findPalette.hide();
    this.terminal?.focus();
    return true;
  }

  findNext () {
    if (!this.terminal || !this.findPalette) return false;
    this.findPalette.findNext();
    return true;
  }

  findPrevious () {
    if (!this.terminal || !this.findPalette) return false;
    this.findPalette.findPrevious();
    return true;
  }

  showNotification (
    message: string,
    infoType: string,
    { restartButtonText = 'Restart', force = false }: {
      restartButtonText?: string,
      force?: boolean
    } = {}
  ) {
    if (!Config.get('behavior.showNotifications') && !force) return;
    let messageElement = document.createElement('div');
    let restartButtonElement = document.createElement('button');
    restartButtonElement.appendChild(document.createTextNode(restartButtonText));

    restartButtonElement.addEventListener(
      'click',
      () => this.restartPtyProcess(),
      { passive: true }
    );
    restartButtonElement.classList.add(
      'btn',
      `btn-${infoType}`,
      'terminal__btn-restart'
    );

    messageElement.classList.add(`terminal__notification--${infoType}`);
    messageElement.appendChild(document.createTextNode(message));
    messageElement.appendChild(restartButtonElement);

    if (this.div) {
      this.div.top.innerHTML = ''; // TODO
      this.div.top.appendChild(messageElement);
    }

    switch (infoType) {
      case 'success':
        atom.notifications.addSuccess(message);
        break;
      case 'error':
        atom.notifications.addError(message);
        break;
      case 'warning':
        atom.notifications.addWarning(message);
        break;
      case 'info':
        atom.notifications.addInfo(message);
        break;
      default:
        throw new Error(`Unknown notification type: ${infoType}`);
    }
  }

  async promptToStartup () {
    let message;

    let command = [this.getShellCommand(), ...this.getArgs()];
    message = `New command ${JSON.stringify(command)} ready to start.`;

    this.showNotification(message, 'info', { restartButtonText: 'Start' });
  }

  async restartPtyProcess () {
    if (this.#ptyMeta?.running) {
      this.pty?.removeAllListeners('exit');
      this.pty?.kill();
      this.#ptyMeta.running = false;
    }

    let cwd = await this.getCwd();

    this.terminal?.reset();

    this.#ptyMeta.options ??= {};
    this.#ptyMeta.command = this.getShellCommand();
    this.#ptyMeta.args = this.getArgs();

    let name = this.getTerminalType();
    let env = this.getEnv();
    let encoding = this.getEncoding();

    this.#ptyMeta.options = { name, cwd, env };

    if (encoding && this.#ptyMeta.options) {
      // Only set encoding if there's an actual encoding to set.
      this.#ptyMeta.options.encoding = encoding;
    }

    this.#ptyMeta.options.cols = this.pty?.cols;
    this.#ptyMeta.options.rows = this.pty?.rows;

    // Because we `await` after the we check for the presence of the PTY
    // earlier, we need to check again just to make sure.
    if (this.#ptyMeta?.running || this.pty) {
      this.pty?.removeAllListeners('exit');
      this.pty?.kill();
      this.#ptyMeta.running = false;
    }

    this.pty = undefined;
    this.#ptyMeta.running = false;

    try {
      this.pty = new Pty({
        file: this.#ptyMeta.command ?? '',
        args: this.#ptyMeta.args,
        options: this.#ptyMeta.options
      });
      this.uid = this.pty.id;
      if (this.pty.process) {
        this.pty.onData((data) => {
          if (!this.terminal || !this.model || !this.pty) {
            throw new Error('No terminal or model for incoming PTY data');
          }
          // Whenever we receive data, check for an updated title.
          if (!isWindows() && this.pty.title) {
            this.model.title = this.pty.title;
          }
          this.terminal.write(data);
          this.model.handleNewData();
        });

        // Handle the PTY exiting on its own, like if the user runs `exit` or
        // `logout`.
        this.pty.onExit((exitCode) => {
          if (!this.terminal || !this.model) {
            throw new Error('No terminal or model for incoming PTY data');
          }
          this.#ptyMeta.running = false;
          if (!this.leaveOpenAfterExit()) {
            this.model.exit();
          } else {
            this.terminal.write(`[Exited with code ${exitCode}]`);
          }
        });
        await this.pty.booted();
        this.#ptyMeta.running = true;
        this.refitTerminal();
        this.focusTerminal();

        if (this.div) {
          this.div.top.innerHTML = ''; // TODO
        }
        await this.pty.ready();
        this.refitTerminal();
      }
    } catch (error) {
      // TODO: If there's an error in spawning the PTY, it will likely surface
      // in async fashion. But even that seems not to be happening in tests!
      // Pointing to an invalid file path for the initial command doesn't seem
      // to trigger any error; it just does nothing indefinitely.
      let message = `Launching ‘${this.#ptyMeta.command}’ raised the following error: ${(error as any).message}`;
      if ((error as any).message.startsWith('File not found:')) {
        message = `Could not find command ‘${this.#ptyMeta.command}’.`;
      }
      this.showNotification(message, 'error', { force: true });
      this.pty = undefined;
      this.#ptyMeta.running = false;
    }
  }

  clear () {
    this.terminal?.clear();
  }

  sendSignal (signal: Signal) {
    if (!isSafeSignal(signal)) {
      console.warn('Invalid signal');
      return false;
    }
    if (!this.terminal) {
      console.warn('No terminal!');
      return false;
    }
    if (!this.pty) {
      console.warn('No PTY!');
      return false;
    }

    switch (signal) {
      case 'SIGTERM':
        this.destroy();
        return true;
      case 'SIGINT':
        this.pty.write('\x03');
        return true;
      case 'SIGQUIT':
        this.pty.write('\x1c');
        return true;
      default:
        return false;
    }
  }

  refitTerminal () {
    if (!this.terminal || !this.#fitAddon) return;
    if (!this.#terminalInitiallyVisible) {
      return;
    }
    if (!this.#mainContentRect) {
      return;
    }
    if (this.#mainContentRect.height === 0 || this.#mainContentRect.width === 0) {
      return;
    }
    this.#fitAddon.fit();
    let geometry = this.#fitAddon.proposeDimensions();
    if (!geometry || !this.isPtyProcessRunning() || !this.pty) {
      return
    }
    // We originally had this so that a call to `resize` didn't happen unless
    // the refit resulted in a change in geometry. But we seem to get better
    // results if we call this method redundantly!
    this.pty.resize(geometry.cols, geometry.rows);
    this.#ptyMeta.cols = geometry.cols;
    this.#ptyMeta.rows = geometry.rows;
  }

  async focusTerminal (double: boolean = false) {
    await this.ready();
    if (!this.terminal || !this.model) return;
    this.model.setActive();
    this.terminal.focus();
    if (double) {
      // Second focus will send command to pty.
      this.terminal.focus();
    }
  }

  selectAll () {
    this.terminal?.selectAll();
  }

  hide () {
    if (!this.div) return;
    this.div.terminal.style.visibility = 'hidden';
  }

  show () {
    if (!this.div) return;
    this.div.terminal.style.visibility = 'visible';
  }
}

customElements.define('pulsar-terminal', TerminalElement);
