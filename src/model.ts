import { Dock, Emitter, Pane, PaneItem, PaneItemLocation } from "atom";
import { TerminalElement } from "./element";

import path from 'path';
// import os from 'os';

import fs from 'fs-extra';
import { generateUri, getCurrentCwd, recalculateActive } from "./utils";
import { Config } from "./config";

export type TerminalModelOptions = {
  terminals: Set<TerminalModel>;
  uri: string;
};

const DEFAULT_TITLE = 'Terminal';

const ALLOWED_LOCATIONS: PaneItemLocation[]  = ['left', 'right', 'center', 'bottom'];

export class TerminalModel {

  static is (other: unknown): other is TerminalModel {
    return other instanceof TerminalModel;
  }

  options: TerminalModelOptions;
  public cwd: string | undefined = undefined;
  private url: URL;
  terminals: TerminalModelOptions['terminals'];
  sessionId: string;
  initializedPromise: Promise<void>;
  initialized: boolean = false;
  title?: string;

  activeIndex: number = 0;

  // profile: ProfileData;
  modified: boolean = false;

  emitter = new Emitter();

  element: TerminalElement | null = null;
  pane: Pane | null = null;
  dock: Dock | null = null;

  #lastTitle?: string

  constructor (options: TerminalModelOptions) {
    this.options = options;
    let uri = this.options.uri;
    this.url = new URL(uri);
    this.sessionId = this.url.host;
    this.terminals = this.options.terminals;
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

  async initialize () {
    let cwd: string | undefined;

    if (this.cwd) {
      cwd = this.cwd;
    } else if (Config.get('terminal.useProjectRootAsCwd')) {
      let previousActiveItem = atom.workspace.getActivePaneItem() as any;
      if (typeof previousActiveItem?.getPath === 'function') {
        cwd = previousActiveItem.getPath();
        let [dir] = atom.project.relativizePath(cwd ?? '');
        if (dir) {
          this.cwd = dir;
          return;
        }
      } else if (typeof previousActiveItem?.selectedPath === 'string') {
        cwd = previousActiveItem.selectedPath;
        let [dir] = atom.project.relativizePath(cwd ?? '');
        if (dir) {
          this.cwd = dir;
          return;
        }
      } else {
        cwd = atom.project.getPaths()[0];
      }
    } else {
      cwd = Config.get('terminal.cwd');
    }

    // Now that we have a `cwd`, check if it exists on the filesystem. If it
    // doesn't, bail!
    let exists = cwd && await fs.exists(cwd);
    if (!exists) {
      this.cwd = Config.get('terminal.cwd');
      return;
    }

		// Otherwise, use the path or parent directory as appropriate.
    if (cwd) {
      const stats = await fs.stat(cwd);
      if (stats?.isDirectory()) {
        this.cwd = cwd ?? null;
        // this.profile.cwd = (cwd);
        return;
  		}
    }

    if (cwd) {
      cwd = path.dirname(cwd);
      let dirStats = await fs.stat(cwd);
      if (dirStats.isDirectory()) {
        this.cwd = cwd ?? null;
        // this.profile.cwd = (cwd);
        return;
      }
    }

    this.cwd = cwd ?? undefined;
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

  getPath () {
    return getCurrentCwd();
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

  isModified () {
    return this.modified;
  }

  onDidChangeTitle (callback: (newTitle: string) => unknown) {
    return this.emitter.on('did-change-title', callback);
  }

  onDidChangeModified (callback: (newValue: boolean) => unknown) {
    return this.emitter.on('did-change-modified', callback);
  }

  handleNewData () {
    this.pane ??= atom.workspace.paneForItem(this) ?? null;
    let oldIsModified = this.modified;

    let item: PaneItem | undefined = undefined;
    if (this.pane) {
      item = this.pane.getActiveItem();
    }
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
    return this.activeIndex === 0 && this.isVisible();
  }

  isVisible () {
    if (!this.pane) return false;
    if (this.pane.getActiveItem() !== (this as unknown)) return false;
    if (!this.dock) return true;
    if (this.dock.isVisible()) return true;
    return false;
  }

  setElement (element: TerminalElement | null) {
    this.element = element;
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
        this.dock = null;
    }
  }

  async ready () {
    return await this.initializedPromise;
  }

  getProfile () {
    return {} // TODO
  }

  applyProfileChanges (_profileChanges: unknown) {
    // TODO
  }

  getSessionId () {
    return this.sessionId;
  }

  getSessionParameters () {
    return '';
  }

  refitTerminal () {
    this.element?.refitTerminal();
  }

  focusTerminal (double: boolean = false) {
    this.pane?.activateItem(this);
    this.element?.focusTerminal(double);
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

  copyFromTerminal () {
    return this.element?.terminal?.getSelection();
  }

  paste (text: string) {
    this.element?.pty?.write(text);
  }

  run (command: string) {
    this.element?.pty?.write(command);
  }

  clear () {
    this.element?.clear();
  }

  setActive () {
    recalculateActive(this.terminals, this);
  }

  getElement () {
    return this.element!;
  }

  updateTheme () {
    this.element?.updateTheme();
  }

  setIndex (newIndex: number) {
    this.activeIndex = newIndex;
    this.emitter.emit('did-change-title');
  }
}
