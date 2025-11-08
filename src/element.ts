import fs from 'fs-extra';

import { CompositeDisposable, Disposable } from 'atom';
import { TerminalModel } from './model';
import { Config } from './config';

import { ITheme, Terminal as XTerminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { WebLinksAddon } from '@xterm/addon-web-links';
import { WebglAddon } from '@xterm/addon-webgl';
import { LigaturesAddon } from '@xterm/addon-ligatures';
import { SearchAddon } from '@xterm/addon-search';

import FindPalette from './find-palette';

import { Pty } from './pty';
import { IPtyForkOptions, IWindowsPtyForkOptions } from 'node-pty';

import { debounce, isWindows } from './utils';
import { getTheme } from './themes';

// TODO: Pulsar complains if I import this from `@electron/remote`. But somehow
// I can import it from `electron` without complaint, even though all it's
// doing under the hood is proxying that call to `@electron/remote`!
// Investigate.

// @ts-ignore
import { remote } from 'electron';

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

export class TerminalElement extends HTMLElement {
  public model?: TerminalModel;
  public terminal?: XTerminal;
  public pty?: Pty;
  public initialized: boolean = false;

  private subscriptions = new CompositeDisposable();
  private initializedPromise?: Promise<void>;
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

    // TODO: Profile menu.

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
    return Config.get('terminal.command');
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

    let fallbackEnv = Config.get('terminal.env.fallbackEnv') ?? {};
    let overrideEnv = Config.get('terminal.env.overrideEnv') ?? {};
    let deleteEnv = Config.get('terminal.env.deleteEnv') ?? [];

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

  shouldPromptToStartup () {
    if (!Config.get('behavior.promptOnStartup')) return false;

    // TODO: Still don't prompt for user-initiated actions. Requires that we
    // distinguish cases when a service spawns a terminal.
    return true;
  }

  isPtyProcessRunning () {
    return this.pty && this.#ptyMeta?.running;
  }

  getXtermOptions () {
    let extraXtermOptions = Config.get('xterm.additionalOptions') ?? {};
    let xtermOptions = {
      cursorBlink: true,
      ...extraXtermOptions
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
    let adjustedLineHeight = clampLineHeight(originalLineHeight, xtermOptions.fontSize);
    xtermOptions.lineHeight = adjustedLineHeight;
    xtermOptions.theme = getTheme();

    return structuredClone(xtermOptions);
  }

  setMainBackgroundColor (theme: ITheme = getTheme()) {
    this.style.backgroundColor = theme?.background ?? '#000000';
  }

  async createTerminal () {
    this.setMainBackgroundColor();

    this.terminal = new XTerminal({
      allowProposedApi: true,
      ...this.getXtermOptions()
    });

    this.#fitAddon = new FitAddon();
    this.terminal.loadAddon(this.#fitAddon);

    if (Config.get('xterm.webLinks')) {
      this.terminal.loadAddon(
        new WebLinksAddon((_, uri) => remote.shell.openExternal(uri))
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

    this.findPalette = new FindPalette(this.#searchAddon);

    if (this.div) {
      this.div.palette.appendChild(this.findPalette.element);
    }

    this.#ptyMeta.cols = 80;
    this.#ptyMeta.rows = 25;

    this.refitTerminal();

    this.pty = undefined;
    this.#ptyMeta.running = false;

    this.subscriptions.add(
      // When the terminal receives input, send it to the PTY.
      this.terminal.onData((data) => {
        if (this.isPtyProcessRunning()) {
          this.pty!.write(data);
        }
      })
    );

    this.subscriptions.add(
      this.terminal.onSelectionChange(() => {
        if (!this.terminal) return;
        if (!Config.get('behavior.copyOnSelect')) return;

        let text = this.terminal.getSelection();
        if (!text) return;

        let rawLines = text.split(/\r?\n/g);
        let lines = rawLines.map(line => line.replace(/\s/g, ' ').trimRight());
        text = lines.join('\n');
        atom.clipboard.write(text);
      })
    );

    if (this.shouldPromptToStartup()) {
      this.promptToStartup();
    } else {
      await this.restartPtyProcess();
    }
  }

  updateTheme () {
    if (!this.terminal) return;
    let theme = getTheme();
    this.setMainBackgroundColor(theme);
    this.terminal.options.theme = { ...theme };
  }

  showFind (prefilledText?: string) {
    if (!this.findPalette) return false;
    this.findPalette.show();
    if (prefilledText) {
      this.findPalette.search(prefilledText);
    }
    return true;
  }

  toggleFind () {
    if (!this.findPalette) return false;
    this.findPalette.toggle();
    return true;
  }

  hideFind () {
    if (!this.findPalette) return false;
    this.findPalette.hide();
    return true;
  }

  findNext () {
    if (!this.findPalette) return false;
    this.findPalette.findNext();
    return true;
  }

  findPrevious () {
    if (!this.findPalette) return false;
    this.findPalette.findPrevious();
    return true;
  }

  showNotification (
    message: string,
    infoType: string,
    restartButtonText: string = 'Restart'
  ) {
    let messageElement = document.createElement('div');
    let restartButtonElement = document.createElement('button');
    restartButtonElement.appendChild(document.createTextNode(restartButtonText));

    restartButtonElement.addEventListener(
      'click',
      () => this.restartPtyProcess(),
      { passive: true }
    );
    restartButtonElement.classList.add('btn', `btn-${infoType}`, 'terminal__btn-restart');

    messageElement.classList.add(`terminal__notification--${infoType}`);
    messageElement.appendChild(document.createTextNode(message));
    messageElement.appendChild(restartButtonElement);

    if (this.div) {
      this.div.top.innerHTML = ''; // TODO
      this.div.top.appendChild(messageElement);
    }

    if (Config.get('behavior.showNotifications')) {
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
  }

  async promptToStartup () {
    let message;
    let title = Config.get('terminal.title');

    if (title === null) {
      let command = [this.getShellCommand(), ...this.getArgs()];
      message = `New command ${JSON.stringify(command)} ready to start.`;
    } else {
      message = `New command for profile ${title} ready to start.`;
    }

    this.showNotification(message, 'info', 'Start');
  }

  async restartPtyProcess () {
    let cwd = await this.getCwd();
    if (this.#ptyMeta?.running) {
      this.pty?.removeAllListeners('exit');
      this.pty?.kill();
    }

    // TODO: Profile.
    this.terminal?.reset();

    this.#ptyMeta ??= {};
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

    this.pty = undefined;
    this.#ptyMeta.running = false;

    try {
      this.pty = new Pty({
        file: this.#ptyMeta.command ?? '',
        args: this.#ptyMeta.args,
        options: this.#ptyMeta.options
      })

      if (this.pty.process) {
        this.#ptyMeta.running = true;
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
        this.pty.onExit((_exitCode) => {
          if (!this.terminal || !this.model) {
            throw new Error('No terminal or model for incoming PTY data');
          }
          this.#ptyMeta.running = false;
          if (!this.leaveOpenAfterExit()) {
            this.model.exit();
          } else {
            // TODO: Show a notification whether successful exit or not? Feels weird.
          }
        });
        await this.pty.ready();
        this.refitTerminal();
        this.focusTerminal();

        if (this.div) {
          this.div.top.innerHTML = ''; // TODO
        }
      }
    } catch (error) {
      let message = `Launching ‘${this.#ptyMeta.command}’ raised the following error: ${(error as any).message}`;
      if ((error as any).message.startsWith('File not found:')) {
        message = `Could not find command ‘${this.#ptyMeta.command}’.`;
      }
      this.showNotification(message, 'error');
    }
  }

  clear () {
    this.terminal?.clear();
  }

  refitTerminal () {
    if (!this.#terminalInitiallyVisible) return;
    if (!this.#mainContentRect) return;
    if (this.#mainContentRect.height === 0 || this.#mainContentRect.width === 0) {
      return;
    }
    this.#fitAddon!.fit();
    let geometry = this.#fitAddon!.proposeDimensions();
    if (!geometry || !this.isPtyProcessRunning() || !this.pty) {
      return
    }
    if (this.#ptyMeta.cols !== geometry.cols || this.#ptyMeta.rows !== geometry.rows) {
      this.pty.resize(geometry.cols, geometry.rows);
      this.#ptyMeta.cols = geometry.cols;
      this.#ptyMeta.rows = geometry.rows;
    }
  }

  focusTerminal (double: boolean = false) {
    if (!this.terminal || !this.model) return;
    this.model.setActive();
    this.terminal.focus();
    if (double) {
      // Second focus will send command to pty.
      this.terminal.focus();
    }
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
