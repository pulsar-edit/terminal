
import { CommandEvent, CompositeDisposable, Pane, TextEditorElement, WorkspaceOpenOptions } from  'atom';
import { Config, getConfigSchema } from './config';
import { TerminalElement } from './element';
import { TerminalModel } from './model';
import { debounce, recalculateActive } from './utils';
import crypto from 'crypto';

type OpenOptions = WorkspaceOpenOptions & {
  target?: HTMLElement
};

export const BASE_URI = `terminal://`;

export default class Terminal {

  static subscriptions: CompositeDisposable;
  static terminals: Set<TerminalModel>;

  static config: Record<string, unknown> = getConfigSchema();

  static activate (_state: unknown) {
    this.subscriptions = new CompositeDisposable();
    this.terminals = new Set();

    this.subscriptions.add(
      // Register view provider for the terminal emulator.
      atom.views.addViewProvider(TerminalModel, (model) => {
        let element = new TerminalElement();
        element.initialize(model as TerminalModel);
        return element;
      }),

      // ... et cetera

      // Add an opener for the terminal emulator.
      atom.workspace.addOpener((uri: string) => {
        if (!uri.startsWith(BASE_URI)) return undefined;
        let item = new TerminalModel({
          uri,
          terminals: this.terminals
        });
        return item;
      }),

      // Set a callback to run on current and future panes.
      atom.workspace.observePanes((pane) => {
        // In callback, set another callback to run on current and future
        // items.
        this.subscriptions.add(
          pane.observeItems((item) => {
            if (TerminalModel.is(item)) {
              item.moveToPane(pane);
            }
            recalculateActive(this.terminals);
          })
        )
        recalculateActive(this.terminals);
      }),

      // Add callbacks to run for current and future active items on active
      // panes.
      atom.workspace.observeActivePaneItem((item) => {
        // Move focus into the terminal when the item is a terminal item.
        if (TerminalModel.is(item)) {
          item.focusTerminal();
        }
        recalculateActive(this.terminals);
      }),

      // Commands.
      atom.commands.add('atom-workspace', {
        // Focuses the active terminal; if there is no active terminal, creates
        // a new terminal in the default location and focuses it.
        'terminal:focus': () => this.focus(),
        'terminal:open': () => {
          this.open(
            this.generateUri(),
            this.addDefaultPosition()
          );
        },
        'terminal:open-center': () => {
          this.openInCenterOrDock(atom.workspace);
        },
        'terminal:open-split-up': () => {
          this.open(this.generateUri(), { split: 'up' });
        },
        'terminal:open-split-down': () => {
          this.open(this.generateUri(), { split: 'down' });
        },
        'terminal:open-split-left': () => {
          this.open(this.generateUri(), { split: 'left' });
        },
        'terminal:open-split-right': () => {
          this.open(this.generateUri(), { split: 'right' });
        },
        'terminal:open-split-bottom-dock': () => {
          this.openInCenterOrDock(atom.workspace.getBottomDock());
        },
        'terminal:open-split-left-dock': () => {
          this.openInCenterOrDock(atom.workspace.getLeftDock());
        },
        'terminal:open-split-right-dock': () => {
          this.openInCenterOrDock(atom.workspace.getRightDock());
        },
        // TODO: Reorganize?
        'terminal:close-all': () => {
          this.exitAllTerminals();
        },
        'terminal:insert-selected-text': () => {
          this.insertSelection();
        },
        'terminal:run-selected-text': () => {
          this.runSelection();
        },
        'terminal:focus-next': () => this.focusNext(),
        'terminal:focus-previous': () => this.focusPrevious()
      })
    );

    atom.commands.add('pulsar-terminal', {
      'core:copy': (event) => {
        let element = this.inferTerminalElement(event);
        if (!element) return;
        atom.clipboard.write(element.terminal?.getSelection() ?? '');
      },
      'core:paste': (event) => {
        let element = this.inferTerminalElement(event);
        if (!element) return;
        let textToPaste = atom.clipboard.read();
        element.getModel()?.paste(textToPaste);
      },
      'terminal:restart': (event) => {
        let element = this.inferTerminalElement(event);
        if (!element) return;
        element.restartPtyProcess();
      },
      'terminal:unfocus': () => {
        atom.views.getView(atom.workspace).focus();
      },
      'terminal:clear': (event) => {
        let element = this.inferTerminalElement(event);
        if (!element) return;
        element.clear();
      },
      'terminal:find': (event) => {
        let element = this.inferTerminalElement(event);
        if (!element) return;

        let didShow = element.showFind();
        if (!didShow) event.abortKeyBinding();
      },
      'terminal:find-next': (event) => {
        let element = this.inferTerminalElement(event);
        if (!element) return;

        let didRespond = element.findNext();
        if (!didRespond) event.abortKeyBinding();
      },
      'terminal:find-previous': (event) => {
        let element = this.inferTerminalElement(event);
        if (!element) return;

        let didRespond = element.findPrevious();
        if (!didRespond) event.abortKeyBinding();
      }
    });

    atom.commands.add('.terminal-find-palette atom-text-editor', {
      'core:cancel': (event) => {
        let element = this.inferTerminalElement(event);
        if (!element) return;

        let didHide = element.hideFind();
        if (!didHide) event.abortKeyBinding();
      }
    });

    let debouncedUpdateTheme = debounce(() => this.updateTheme());

    this.subscriptions.add(
      // Immediately apply new theme colors.
      atom.config.onDidChange('terminal.appearance', debouncedUpdateTheme),
      atom.themes.onDidChangeActiveThemes(debouncedUpdateTheme)
    );

    let docks = [
      atom.workspace.getRightDock(),
      atom.workspace.getLeftDock(),
      atom.workspace.getBottomDock()
    ];

    let dockDisposables = docks.map((dock) => {
      return dock.observeVisible((visible) => {
        if (visible) {
          let item = dock.getActivePaneItem();
          if (TerminalModel.is(item)) {
            item.focusTerminal();
          }
        }
        recalculateActive(this.terminals);
      })
    });

    this.subscriptions.add(...dockDisposables);
  }

  // Given a command event, determine the
  static inferTerminalElement (event: CommandEvent): TerminalElement | null {
    if (!event.target || !(event.target instanceof HTMLElement)) return null;
    return event.target.closest('pulsar-terminal') as TerminalElement | null;
  }

  static async open (uri: string, options: OpenOptions = {}): Promise<TerminalModel> {
    let url = new URL(uri);
    if (url.searchParams.get('relaunchTerminalOnStartup') === null) {
      url.searchParams.set('relaunchTerminalOnStartup', 'false');
    }

    if (options.target) {
      let target = this.getPath(options.target);
      if (target) {
        url.searchParams.set('cwd', target);
      }
    }

    return await atom.workspace.open(url.href, options) as Promise<TerminalModel>;
  }

  /**
   * Service function for opening a terminal.
   */
  static async openTerminal (options: OpenOptions = {}) {
    options = this.addDefaultPosition(options);
    return await this.open(this.generateUri(), options);
  }

  /**
   * Service function which opens a terminal and runs the given commands.
   *
   * Configuration determines whether a new terminal is opened or an existing
   * terminal is reused.
   */
  static async runCommands (commands: string[]) {
    let terminal;
    if (Config.get('behavior.runInActive')) {
      terminal = this.getActiveTerminal();
    }
    if (!terminal) {
      terminal = await this.open(this.generateUri(), this.addDefaultPosition());
    }
    if (!terminal.element) return;
    await terminal.element.ready();

    for (let command of commands) {
      terminal.run(command);
    }
  }

  static async openInCenterOrDock (
    centerOrDock: { getActivePane(): Pane },
    options: OpenOptions = {}
  ) {
    let pane = centerOrDock.getActivePane();
    if (pane) options.pane = pane;

    return await this.open(this.generateUri(), options);
  }

  // Given an element that the user clicked on, attempt to infer a path.
  static getPath (target: HTMLElement | undefined | null) {
    if (!target) {
      let [firstPath] = atom.project.getPaths();
      return firstPath ?? null;
    }

    let treeView = target.closest('.tree-view') as HTMLElement | undefined;
    if (treeView) {
      let selected = treeView.querySelector(
        '.selected > .list-item > .name, .selected > .name'
      ) as HTMLElement | undefined;
      return selected?.dataset.path ?? null;
    }

    let tab = target.closest('.tab-bar > tab') as HTMLElement | undefined;
    if (tab) {
      let title = tab.querySelector('.title') as HTMLElement | undefined;
      return title?.dataset.path ?? null;
    }

    let textEditor = target.closest('atom-text-editor') as TextEditorElement | undefined;
    if (textEditor && typeof textEditor.getModel === 'function') {
      let model = textEditor.getModel();
      return model.getPath?.() ?? null;
    }

    return null;
  }

  // Given an existing set of options to pass to `atom.workspace.open`,
  // augments it with the default destination, if needed.
  static addDefaultPosition (options: OpenOptions = {}) {
    let position = Config.get('behavior.defaultContainer');
    switch (position) {
      case 'Center': {
        let pane = atom.workspace.getActivePane();
        if (pane && !('pane' in options)) {
          options.pane = pane;
        }
        break;
      }
      case 'Split Up':
        if (!('split' in options)) {
          options.split = 'up';
        }
        break;
      case 'Split Down':
        if (!('split' in options)) {
          options.split = 'down';
        }
        break;
      case 'Split Left':
        if (!('split' in options)) {
          options.split = 'left';
        }
        break;
      case 'Split Right':
        if (!('split' in options)) {
          options.split = 'right';
        }
        break;
      case 'Bottom Dock': {
        let pane = atom.workspace.getBottomDock().getActivePane();
        if (pane && !('pane' in options)) {
          options.pane = pane;
        }
        break;
      }
      case 'Left Dock': {
        let pane = atom.workspace.getLeftDock().getActivePane();
        if (pane && !('pane' in options)) {
          options.pane = pane;
        }
        break;
      }
      case 'Right Dock': {
        let pane = atom.workspace.getRightDock().getActivePane();
        if (pane && !('pane' in options)) {
          options.pane = pane;
        }
        break;
      }
    }
    return options;
  }

  static deactivate () {
    this.exitAllTerminals();
    this.subscriptions?.dispose();
  }

  static updateTheme () {
    for (let terminal of this.terminals) {
      terminal.updateTheme();
    }
  }

  static deserializeTerminalModel (serializedModel: { uri: string }) {
    console.warn('[Terminal] deserializeTerminalModel:', serializedModel);
    let pack = atom.packages.enablePackage('terminal');
    if (!pack) return;
    // @ts-ignore Undocumented.
    pack.preload();
    // @ts-ignore Undocumented.
    pack.activateNow();

    // if (!Config.get('terminal.allowRelaunchingOnStartup')) return;
    let url = new URL(serializedModel.uri);
    // let relaunch = url.searchParams.get('relaunchTerminalOnStartup');
    // if (relaunch === 'false') return;

    return new TerminalModel({
      uri: url.href,
      terminals: this.terminals
    });
  }

  static exitAllTerminals () {
    for (let terminal of this.terminals) {
      terminal.exit();
    }
  }

  static insertSelection () {
    let selection = this.getSelectedText();
    if (!selection) return;
    this.performOnActiveTerminal(term => term.paste(selection));
  }

  static runSelection () {
    let selection = this.getSelectedText();
    if (!selection) return;
    this.performOnActiveTerminal(term => term.run(selection));
  }

  static performOnActiveTerminal (operation: (term: TerminalModel) => unknown) {
    let terminal = this.getActiveTerminal();
    if (!terminal) return;
    operation(terminal);
  }

  static getActiveTerminal () {
    return Array.from(this.terminals).find(term => term.isActive());
  }

  static getSelectedText () {
    let editor = atom.workspace.getActiveTextEditor();
    if (!editor) return '';

    let selectedText = '';
    let selection = editor.getSelectedText();
    if (selection) {
      selectedText = selection.replace(/[\r\n]+$/, '');
    } else {
      let cursor = editor.getCursorBufferPosition();
      if (cursor) {
        let line = editor.lineTextForBufferRow(cursor.row);
        selectedText = line;
        editor.moveDown(1); // TODO: ?
      }
    }

    return selectedText;
  }

  static focus () {
    if (this.terminals.size === 0) {
      this.openTerminal();
      return;
    }

    let activeTerminal = Array.from(this.terminals)
      .find(term => term.activeIndex === 0);
    activeTerminal?.focusTerminal(true);
  }

  static focusNext () {
    if (this.terminals.size === 0) {
      this.openTerminal();
      return;
    }

    let list = Array.from(this.terminals);
    let nextIndex = list.findIndex(t => t.activeIndex === 0) + 1;
    if (nextIndex >= list.length) {
      nextIndex -= list.length;
    }
    list[nextIndex].focusTerminal(true);
  }

  static focusPrevious () {
    if (this.terminals.size === 0) {
      this.openTerminal();
      return;
    }

    let list = Array.from(this.terminals);
    let prevIndex = list.findIndex(t => t.activeIndex === 0) - 1;
    if (prevIndex < 0) {
      prevIndex += list.length;
    }
    list[prevIndex].focusTerminal(true);
  }

  static generateUri() {
    return `${BASE_URI}${crypto.randomUUID()}/`;
  }

  // SERVICES
  // ========

  static provideTerminalService () {
    return {
      run: (commands: string[]) => {
        return this.runCommands(commands);
      },
      open: () => {
        return this.openTerminal();
      }
    }
  }

  /**
   * Provide the `platformioIDETerminal` service.
   */
  static providePlatformioIDETerminalService () {
    return {
      run: (commands: string[]) => {
        return this.runCommands(commands);
      },
      open: () => {
        return this.openTerminal();
      },
      // This is of limited utility because the implementation details of these
      // views vary from those of the original package. Consumer beware.
      getTerminalViews: () => {
        return Array.from(this.terminals);
      },
      // Best evidence is that this method was thought to be needed to copy
      // environment variables from one environment to another… when, in fact,
      // they were executing in the same environment. Hence this is a stub.
      updateProcessEnv: (_vars: Record<string, string>) => {
        // No-op.
      }
    }
  }

}
