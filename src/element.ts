import fs from 'fs-extra';

import { CompositeDisposable, Disposable } from 'atom';
import { TerminalModel } from './model';
import { Config, CONFIG_DEFAULTS } from './config';
import { ProfileData, Profiles } from './profiles';

import { Terminal as XTerminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { WebLinksAddon } from '@xterm/addon-web-links';
import { WebglAddon } from '@xterm/addon-webgl';
import { LigaturesAddon } from '@xterm/addon-ligatures';
import { Pty } from './pty';
import { IPty, IPtyForkOptions, IWindowsPtyForkOptions } from 'node-pty';
// @ts-ignore
// import { shell } from '@electron/remote';
import { getCurrentCwd, isWindows } from './utils';

const PTY_PROCESS_OPTIONS = new Set([
  'command',
	'args',
	'name',
	'cwd',
	'env',
	'setEnv',
	'deleteEnv',
	'encoding'
]);

const TERMINAL_OPTIONS = [
	'leaveOpenAfterExit',
	'relaunchTerminalOnStartup',
	'title',
	'promptToStartup',
];

export class TerminalElement extends HTMLElement {
  model?: TerminalModel;
  disposables = new CompositeDisposable();
  initializedPromise?: Promise<void>;
  initialized: boolean = false;

  terminal?: XTerminal;

  #mainResizeObserver?: ResizeObserver;
  #mainContentRect?: DOMRectReadOnly;
  #terminalIntersectionObserver?: IntersectionObserver | null;
  #terminalInitiallyVisible: boolean = false;

  #pendingProfileData?: Record<string, unknown>;

  #fitAddon?: FitAddon;

  pty: Pty | null = null;

  _pty?: Partial<{
    command?: string;
    args?: string[];
    rows: number;
    cols: number;
    running: boolean;
    options: IPtyForkOptions | IWindowsPtyForkOptions
  }> | undefined = undefined;

  div?: Record<'top' | 'main' | 'menu' | 'terminal', HTMLDivElement>;

  async initialize (model: TerminalModel) {
    console.log('[Terminal] Element initialize model:', model);
    this.model = model;
    this.model.setElement(this);

    this.div = {
      top: document.createElement('div'),
      main: document.createElement('div'),
      menu: document.createElement('div'),
      terminal: document.createElement('div')
    };

    this.div.top.classList.add('terminal__top');
    this.div.main.classList.add('terminal__main');
    this.div.menu.classList.add('terminal__menu');
    this.div.terminal.classList.add('terminal__terminal');
    this.div.main.appendChild(this.div.terminal);

    this.appendChild(this.div.top);
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

      // TODO: Initialize profile menu model?

      this.#mainResizeObserver = new ResizeObserver((entries) => {
        console.log('[Terminal] in main resize observer!');
        let last = entries[entries.length - 1];
        this.#mainContentRect = last.contentRect;
        console.log('Refitting terminal');
        this.refitTerminal();
      });
      this.#mainResizeObserver.observe(this.div.main);

      console.log('[Terminal] Element creating IO…');
      this.#terminalIntersectionObserver = new IntersectionObserver(
        async (entries) => {
          let last = entries[entries.length - 1];

          if (last.intersectionRatio !== 1.0) return;
          this.#terminalInitiallyVisible = true;
          try {
            console.warn('[Terminal] Element creating terminal!');
            await this.createTerminal();
            this.applyPendingTerminalProfileOptions();
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
      this.disposables.add(
        new Disposable(() => this.#terminalIntersectionObserver?.disconnect())
      );

      // Increase or decrease the font size when holding Ctrl and moving the
      // mouse wheel up/down.
      this.div.terminal.addEventListener(
        'wheel',
        (event) => {
          if (!event.ctrlKey) return;
          if (!atom.config.get('terminal.zoomFontWhenCtrlScrolling')) return;
          event.stopPropagation();

          let delta = event.deltaY < 0 ? 1 : -1;
          let fontSize = Config.get('appearance.fontSize') + delta;
          // let fontSize = this.model.profile.fontSize + delta;
          if (fontSize < CONFIG_DEFAULTS.minimumFontSize) {
            fontSize = CONFIG_DEFAULTS.minimumFontSize;
          } else if (fontSize > CONFIG_DEFAULTS.maximumFontSize) {
            fontSize = CONFIG_DEFAULTS.maximumFontSize;
          }
          Config.set('appearance.fontSize', fontSize);
          // this.model.applyProfileChanges({ fontSize });
        },
        { capture: true }
      );
    } catch (error) {
      initializeReject!(error);
      throw error;
    }
    this.initialized = true;
  }

  destroy () {
    // TODO: Destroy profile menu element
    this.pty?.kill();
    this.terminal?.dispose();
    this.disposables.dispose();
  }

  getShellCommand () {
    return Config.get('terminal.command');
    // return this.model.profile.command;
  }

  getArgs () {
    let args = Config.get('terminal.args');
    // let args = this.model.profile.args;
    if (!Array.isArray(args)) {
      throw new Error('Arguments must be an array');
    }
    return args;
  }

  getTerminalType () {
    let terminalType = Config.get('terminal.terminalType');
    return terminalType;
    // return this.model.profile.name;
  }

  async pathIsDirectory (filePath: string) {
    if (!filePath) return false;
    try {
      const stats = await fs.stat(filePath);
      if (stats?.isDirectory()) return true;
    } catch (err) {
      return false;
    }
    return false;
  }

  async getCwd () {
    let cwd = getCurrentCwd();
    // let cwd = this.model.profile.cwd;
    if (await this.pathIsDirectory(cwd)) {
      return cwd;
    }

    cwd = this.model?.getPath();
    if (await this.pathIsDirectory(cwd)) {
      return cwd;
    }

    // If we get this far, the `cwd` on the model is invalid!
    if (this.model) {
      this.model.cwd = null;
    }
    cwd = Profiles.getBaseProfile().cwd;
    if (await this.pathIsDirectory(cwd) && this.model) {
      this.model.cwd = cwd;
      return cwd;
    }

    return null;
  }

  getEnv () {
    // let env: any = this.model?.profile.env ?? { ...process.env };
    let env: any = {};
    if (typeof env !== 'object' || Array.isArray(env) || env === null) {
			throw new Error('Environment set is not an object.')
		}

    let fallbackEnv = Config.get('terminal.fallbackEnv') ?? {};
    let overrideEnv = Config.get('terminal.overrideEnv') ?? {};
    let deleteEnv = Config.get('terminal.deleteEnv') ?? [];

    Object.assign(env, fallbackEnv);
    Object.assign(env, { ...process.env });
    Object.assign(env, overrideEnv);

    for (let key of deleteEnv) {
      delete env[key];
    }

    // let setEnv = this.model?.profile.setEnv as Record<string, unknown> ?? {};
    // let deleteEnv = this.model?.profile.deleteEnv as string[] ?? [];
    // for (let key in setEnv) {
    //   env[key] = setEnv[key];
    // }
    // for (let key of deleteEnv) {
    //   delete env[key];
    // }
    return env;
  }

  getEncoding () {
    return Config.get('terminal.encoding');
    // return this.model.profile.encoding;
  }

  leaveOpenAfterExit () {
    return Config.get('behavior.leaveOpenAfterExit');
    // return this.model.profile.leaveOpenAfterExit;
  }

  shouldPromptToStartup () {
    if (!Config.get('behavior.promptOnStartup')) return false;

    // TODO: Still don't prompt for user-initiated actions. Requires that we
    // distinguish cases when a service spawns a terminal.
    return true;

    // return Config.get('behavior.promptOnStartup') ?? false;
    // return this.model.profile.promptToStartup;
  }

  isPtyProcessRunning () {
    return this.pty && this._pty?.running;
  }

  getTheme (profile: unknown = {}) {
    // TODO: DO THIS COMPLETELY DIFFERENTLY
  }

  getXtermOptions () {
    let extraXtermOptions = Config.get('xterm.additionalOptions') ?? {};
    let xtermOptions = {
      cursorBlink: true,
      ...extraXtermOptions
    };
    xtermOptions.fontSize = Config.get('appearance.fontSize');
    let fontFamilyKey = Config.get('appearance.useEditorFontFamily') ? 'editor.fontFamily' : 'appearance.fontFamily';
    xtermOptions.fontFamily = atom.config.get(fontFamilyKey);
    // xtermOptions.fontSize = this.model.profile.fontSize;
    // xtermOptions.fontFamily = this.model.profile.fontFamily;
    // TODO: Theme!

    return structuredClone(xtermOptions);
  }

  setMainBackgroundColor () {
    // TODO
  }

  async createTerminal () {
    console.log('[Terminal] Element createTerminal!');
    this.setMainBackgroundColor();

    this.terminal = new XTerminal({
      allowProposedApi: true,
      ...this.getXtermOptions()
    });

    this.#fitAddon = new FitAddon();
    this.terminal.loadAddon(this.#fitAddon);

    // if (Config.get('xterm.webLinks')) {
    //   this.terminal.loadAddon(
    //     new WebLinksAddon((_, uri) => shell.openExternal(uri))
    //   );
    // }

    if (this.div) {
      console.warn(`[Terminal] opening in div!`, this.div.terminal);
      this.terminal.open(this.div.terminal);
    }

    if (Config.get('xterm.webgl')) {
      this.terminal.loadAddon(new WebglAddon());
    }

    this.terminal.loadAddon(new LigaturesAddon());

    this._pty ??= {};
    this._pty.cols = 80;
    this._pty.rows = 25;

    console.log('[Terminal] Created and refitting?', this.#terminalInitiallyVisible);
    this.refitTerminal();

    this.pty = null;
    this._pty.running = false;

    console.log('[Terminal] Adding data');
    this.disposables.add(
      this.terminal.onData((data) => {
        if (this.isPtyProcessRunning()) {
          this.pty!.write(data);
        }
      })
    );

    // this.disposables.add(
    //   this.terminal.onSelectionChange(() => {
    //     if (!this.model.profile.copyOnSelect) return;
    //     if (!this.terminal) return;
    //     let text = this.terminal.getSelection();
    //     if (!text) return;
    //
    //     let rawLines = text.split(/\r?\n/g);
    //     let lines = rawLines.map(line => line.replace(/\s/g, ' ').trimRight());
    //     text = lines.join('\n');
    //     atom.clipboard.write(text);
    //   })
    // );

    // this.disposables.add(
    //   Profiles.onDidResetBaseProfile((baseProfile) => {
    //     let frontEndSettings = {};
    //     for (let data of CONFIG_DATA) {
    //       if (!data.profileKey) continue;
    //       if (data.terminalFrontEnd) {
    //         frontEndSettings[data.profileKey] = baseProfile[data.profileKey];
    //       }
    //     }
    //     let profileChanges = Profiles.diffProfiles(
    //       this.model.getProfile(),
    //       // Only allow changes to settings related to the terminal front end
  	// 			// to be applied to existing terminals.
    //       frontEndSettings
    //     );
    //
    //     this.model.applyProfileChanges(profileChanges);
    //   })
    // );

    if (this.shouldPromptToStartup()) {
      this.promptToStartup();
    } else {
      await this.restartPtyProcess();
    }
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
    if (this._pty?.running) {
      this.pty?.removeAllListeners('exit');
      this.pty?.kill();
    }

    // TODO: Profile.
    this.terminal?.reset();

    this._pty ??= {};
    this._pty.options ??= {};
    this._pty.command = this.getShellCommand();
    this._pty.args = this.getArgs();

    let name = this.getTerminalType();
    let env = this.getEnv();
    let encoding = this.getEncoding();

    this._pty.options = { name, cwd, env };

    if (encoding) {
      // Only set encofing if there's an actual encoding to set.
      this._pty.options.encoding = encoding;
    }

    this._pty.options.cols = this.pty?.cols;
    this._pty.options.rows = this.pty?.rows;

    this.pty = null;
    this._pty.running = false;

    try {
      console.log('[Terminal] Declaring new PTY with args:', {
        file: this._pty.command ?? '',
        args: this._pty.args,
        options: this._pty.options
      });
      this.pty = new Pty({
        file: this._pty.command ?? '',
        args: this._pty.args,
        options: this._pty.options
      })

      if (this.pty.process) {
        this._pty.running = true;
        this.pty.onData((data) => {
          console.log('[Terminal] [Element] got data', data);
          if (!this.terminal || !this.model || !this.pty) {
            throw new Error('No terminal or model for incoming PTY data');
          }
          if (!isWindows() && this.pty.title) {
            this.model.title = this.pty.title;
          }
          this.terminal.write(data);
          this.model.handleNewData();
        });
        this.pty.onExit((_exitCode) => {
          console.warn('[Terminal] ON EXIT!', _exitCode);
          if (!this.terminal || !this.model || !this._pty) {
            throw new Error('No terminal or model for incoming PTY data');
          }
          this._pty.running = false;
          if (!this.leaveOpenAfterExit()) {
            this.model.exit();
          } else {
            // TODO: Show a notification whether successful exit or not? Feels weird.
          }
        });
        // this.pty.process.on('data', (data) => {
        //   let oldTitle = ''
        //   if (this.model.profile.title !== null) {
        //     this.model.title = this.model.profile.title;
				// 	} else if (process.platform !== 'win32') {
        //     this.model.title = this.pty.title;
				// 	}
				// 	if (oldTitle !== this.model.title) {
				// 		this.model.emitter.emit('did-change-title', this.model.title)
				// 	}
        //   this.terminal!.write(data)
        //   this.model.handleNewData();
        // });

        // this.pty.process.on('exit', (code, signal) => {
        //   this._pty.running = false;
        //   if (!this.shouldLeaveOpenAfterExit()) {
        //     this.model.exit();
        //   } else {
        //     // TODO: Show a notification whether successful exit or not? Feels weird.
        //   }
        // });
        if (this.div) {
          this.div.top.innerHTML = ''; // TODO
        }
      }
    } catch (error) {
      let message = `Launching ‘${this._pty.command}’ raised the following error: ${(error as any).message}`;
      if ((error as any).message.startsWith('File not found:')) {
        message = `Could not find command ‘${this._pty.command}’.`;
      }
      this.showNotification(message, 'error');
    }
  }

  clear () {
    this.terminal?.clear();
  }

  applyPendingTerminalProfileOptions () {
    if (!this.#pendingProfileData) return;

    // For any changes involving the xterm.js Terminal object, only apply them
		// when the terminal is visible.
    if (this.#terminalInitiallyVisible) {
      // TODO
    }

    for (let key of TERMINAL_OPTIONS) {
      delete this.#pendingProfileData[key];
    }
  }

  refitTerminal () {
    if (!this.#terminalInitiallyVisible) {
      console.log('[Terminal] Skipped refit because terminal not visible yet');
      return;
    }
    if (!this.#mainContentRect) {
      console.log('[Terminal] Skipped > because terminal not visible yet (no contentRect)');
      return;
    }
    if (this.#mainContentRect.height === 0 || this.#mainContentRect.width === 0) {
      console.log('[Terminal] Skipped refit because terminal not visible yet (contentRect is 0 on one or both dimensions)');
      return;
    }

    this.#fitAddon!.fit();
    let geometry = this.#fitAddon!.proposeDimensions();
    if (!geometry || !this.isPtyProcessRunning()) return;
    console.log('[Terminal] Refit has proposed dimensions of… cols:', geometry.cols, 'rows:', geometry.rows);
    if (!this._pty || !this.pty) {
      throw new Error('Impossible!')
    }
    if (this._pty.cols !== geometry.cols || this._pty.rows !== geometry.rows) {
      console.log('[Terminal] Existing dimensions are, by contrast,', this._pty.cols, 'and', this._pty.rows);
      this.pty.resize(geometry.cols, geometry.rows);
      this._pty.cols = geometry.cols;
      this._pty.rows = geometry.rows;
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

  async toggleProfileMenu () {
    // The profile menu needs to be initialized before it can be toggled.
    // TODO
  }

  hide () {
    if (!this.div) return;
    this.div.terminal.style.visibility = 'hidden';
  }

  show () {
    if (!this.div) return;
    this.div.terminal.style.visibility = 'visible';
  }

  scheduleProfileChanges (profileChanges: ProfileData) {
    this.#pendingProfileData = {
      ...this.#pendingProfileData ?? {},
			...profileChanges,
    };
    this.applyPendingTerminalProfileOptions();
  }
}

customElements.define('pulsar-terminal', TerminalElement);
