import {
  Disposable,
  Dock,
  Emitter,
  Pane,
  PaneItem,
  PaneItemLocation
} from "atom";
import { TerminalElement } from "./element";

import path from 'path';
// Use Node's URL-parsing library because of greater tolerance of nonstandard
// protocols.
import { URL } from 'url';
import os from 'os';

import fs from 'fs-extra';
import { generateUri, getCurrentCwd, recalculateActive, timeout } from "./utils";
import { Config } from "./config";

export type TerminalModelOptions = {
  terminals: Set<TerminalModel>;
  uri: string;
};

const DEFAULT_TITLE = 'Terminal';

const ALLOWED_LOCATIONS: PaneItemLocation[]  = ['center', 'bottom', 'left', 'right'];

/**
 * The representation of a terminal in the Atom workspace.
 */
export class TerminalModel {
  static is (other: unknown): other is TerminalModel {
    return other instanceof TerminalModel;
  }

  static recalculateActive (terminals: Set<TerminalModel>, active?: TerminalModel) {
    return recalculateActive(terminals, active);
  }

  public sessionId: string;
  public activeIndex: number;
  public title: string;
  public initialized: boolean = false;
  public modified: boolean = false;
  public cwd: string | undefined = undefined;
  public terminals: TerminalModelOptions['terminals'];
  public initializedPromise: Promise<void>;
  public emitter = new Emitter();

  private url: URL;

  public element?: TerminalElement | undefined = undefined;
  public pane: Pane | undefined = undefined;
  public dock: Dock | undefined = undefined;

  #lastTitle?: string

  constructor (options: TerminalModelOptions) {
    let uri = options.uri;
    this.url = new URL(uri);
    this.sessionId = this.url.host;
    this.terminals = options.terminals;
    this.activeIndex = this.terminals.size;
    this.title = DEFAULT_TITLE;

    this.cwd = this.url.searchParams.get('cwd') ?? undefined;

    this.terminals.add(this);

    this.initializedPromise = this.initialize().then(() => {
      this.initialized = true;
    })
  }

  get uri () {
    return this.url.toString();
  }

  async getInitialCwd () {
    let cwd: string | undefined;

    // First, collect candidates for the `cwd`.
    if (this.cwd) {
      // This terminal might've been declared with an explicit cwd.
      cwd = this.cwd;
    } else {
      // Failing that, we may be in a project, and the user may want us to
      // consider the project root as the fallback cwd.
      //
      // But a project may have multiple roots! So instead of just arbitrarily
      // selecting the first root, we'll try to privilege the one related to an
      // active pane item.
      let previousActiveItem = atom.workspace.getActivePaneItem() as any;
      cwd = previousActiveItem?.getPath?.() ?? previousActiveItem?.selectedPath;
      if (cwd) {
        let [dir] = atom.project.relativizePath(cwd);
        if (dir) {
          // We can skip the verification step because we have some strong
          // indicators that this path truly does exist on the filesystem.
          return dir;
        }
      }
    }

    try {
      if (cwd) {
        // If we get this far, we think we have a valid cwd, but we should make
        // sure it exists on the filesystem.
        let stats = await fs.stat(cwd);
        if (stats.isDirectory()) return cwd;

        // Maybe it's the path to a file? Try its parent directory just to be
        // safe.
        cwd = path.dirname(cwd);
        let dirStats = await fs.stat(cwd);
        if (dirStats.isDirectory()) return cwd;
      }
    } catch {
      // Fail silently.
    }

    // We've struck out. Fall back to the first project root.
    cwd = atom.project.getPaths()[0];


    if (cwd) {
      // TODO: Ideally, we'd be able to keep `cwd` up to date even when it's
      // changed via `cd` and other commands. VS Code can only do this by
      // integrating into the shell; the approach is different for bash vs zsh
      // vs fish vs PowerShell.
      //
      // So for now, we'll store the original `cwd` we decided on upon
      // creation, and that'll have to do. This is what will be used as the
      // initial `cwd` if the user duplicates this pane item — as would happen
      // if a pane were split.
      this.url.searchParams.set('cwd', cwd);
    }

    return cwd;
  }

  async initialize () {
    this.cwd = await this.getInitialCwd();
  }

  serialize () {
    return {
      deserializer: 'TerminalModel',
      version: '1.0.0',
      uri: this.uri
    };
  }

  destroy () {
    this.element?.destroy();
    this.terminals.delete(this);
  }

  getTitle () {
    let prefix = this.isActive() ? `${this.getActiveIndicator()}` : '';
    return `${prefix}${this.title}`;
  }

  getElement () {
    return this.element!;
  }

  getPath () {
    return this.cwd ?? getCurrentCwd();
  }

  getURI () {
    return this.uri;
  }

  getAllowedLocations() {
    return ALLOWED_LOCATIONS;
  }

  getLongTitle () {
    if (this.title === DEFAULT_TITLE) {
      return DEFAULT_TITLE;
    }
    return `${DEFAULT_TITLE} (${this.title})`;
  }

  getActiveIndicator () {
    return Config.get('terminal.activeTerminalIndicator');
  }

  getIconName () {
    return 'terminal';
  }

  // A “modified” buffer has a dot on the tab bar instead of the close icon.
  // But this isn't coupled to the underlying modified state of the document!
  // In our case, we can repurpose this indicator to mean ”output you haven't
  // yet seen” without having to (for instance) prompt the user to save if they
  // close the terminal without looking at that output.
  isModified () {
    return this.modified;
  }

  setElement (element: TerminalElement | undefined) {
    this.element = element ?? undefined;
    this.emitter.emit('did-create-element', element);
  }

  onDidChangeTitle (callback: (newTitle: string) => unknown) {
    return this.emitter.on('did-change-title', callback);
  }

  onDidChangeModified (callback: (newValue: boolean) => unknown) {
    return this.emitter.on('did-change-modified', callback);
  }

  handleNewData () {
    this.pane ??= atom.workspace.paneForItem(this) ?? undefined;

    let oldIsModified = this.modified;
    let item: PaneItem | undefined = undefined;
    if (this.pane) {
      item = this.pane.getActiveItem();
    }
    // When this pane isn't the active item, set `modified` to `true`.
    this.modified = item !== (this as unknown);

    if (oldIsModified !== this.modified) {
      this.emitter.emit('did-change-modified', this.modified);
    }

    if (this.title !== this.#lastTitle) {
      this.emitter.emit('did-change-title', this.getTitle());
    }

    this.#lastTitle = this.title;
  }

  isActive () {
    const activeLogic = Config.get('behavior.activeTerminalLogic');
    return this.activeIndex === 0 && (this.isVisible() || activeLogic === 'all');
  }

  isVisible () {
    if (!this.pane) return false;
    if (this.pane.getActiveItem() !== (this as unknown)) return false;
    if (!this.dock) return true;
    if (this.dock.isVisible()) return true;
    return false;
  }

  onDidCreateElement(callback: (element: TerminalElement) => unknown) {
    return this.emitter.on('did-create-element', callback);
  }

  async waitForElement (timeoutMs: number = 2000) {
    if (this.element) return Promise.resolve(this.element);
    let promise = new Promise((resolve) => {
      let disposable: Disposable | undefined = undefined;
      disposable = this.onDidCreateElement((elem) => {
        resolve(elem);
        disposable?.dispose();
      });
    });
    return await timeout(promise, timeoutMs);
  }

  moveToPane (pane: Pane) {
    this.pane = pane;
    // @ts-ignore TODO: Update @pulsar-edit/types.
    let location = pane.getContainer().getLocation();
    switch (location) {
      case 'left':
        this.dock = atom.workspace.getLeftDock();
        break;
      case 'right':
        this.dock = atom.workspace.getRightDock();
        break;
      case 'bottom':
        this.dock = atom.workspace.getBottomDock();
        break;
      default:
        this.dock = undefined;
    }
  }

  async ready () {
    return await this.initializedPromise;
  }

  getSessionId () {
    return this.sessionId;
  }

  refitTerminal () {
    this.element?.refitTerminal();
  }

  async focusTerminal (double: boolean = false) {
    this.pane?.activateItem(this);
    if (!this.element) {
      try {
        await this.waitForElement();
      } catch {
        return;
      }
    }
    this.element!.focusTerminal(double);
    if (this.modified) {
      this.modified = false;
      this.emitter.emit('did-change-modified', this.modified);
    }
  }

  exit () {
    this.pane?.destroyItem(this, true);
  }

  restartPtyProcess () {
    this.element?.restartPtyProcess();
  }

  getParams() {
    let result: Record<string, string> = {};
    let params = this.url.searchParams;
    for (let [key, value] of params.entries()) {
      result[key] = value;
    }
    return result;
  }

  // Make a new copy of this terminal. This is used whenever we split the
  // current pane item into a new container.
  copy () {
    return new TerminalModel({
      uri: generateUri(this.getParams()),
      terminals: this.terminals
    });
  }

  getSelection () {
    let selection = this.element?.terminal?.getSelection();
    return selection;
  }

  /** Write text into the terminal. */
  paste (text: string) {
    this.element?.pty?.write(text);
  }

  /** Select all text in the terminal. */
  selectAll () {
    this.element?.selectAll();
  }

  /**
   * Run a command.
   *
   * Like `paste`, except it inserts a carriage return at the end of the input.
   */
  run (command: string) {
    this.element?.pty?.write(command + os.EOL.charAt(0));
  }

  sendSequence (sequence: string[]) {
    this.element?.sendSequence(sequence);
  }

  /** Clear the screen. */
  clear () {
    this.element?.clear();
  }

  /** Make this terminal the active terminal. */
  setActive () {
    recalculateActive(this.terminals, this);
  }

  /** Recalculate the theme colors and font metadata. */
  updateTheme () {
    this.element?.updateTheme();
  }

  // Set a new `activeIndex` for this terminal. Don't use this; it's for
  // `recalculateActive`.
  setIndex (newIndex: number) {
    this.activeIndex = newIndex;
    this.emitter.emit('did-change-title', this.getTitle());
  }
}
