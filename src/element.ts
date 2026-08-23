import fs from 'fs-extra';
import { fileURLToPath } from 'url';

import { CompositeDisposable, Disposable, KeyBinding } from 'atom';
import { isSafeSignal, Signal, TerminalModel } from './model';
import { Config } from './config';
import * as Logger from './log';

import { IBufferCellPosition, IBufferRange, ILinkHandler, ITerminalOptions, ITheme, IViewportRange, Terminal as XTerminal } from '@xterm/xterm';
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
  getElementName,
  isMac,
  isWindows,
  PACKAGE_NAME,
  parseEnvConfigValue,
  timeout,
  willUseConPTY,
  windowsBuildNumber
} from './utils';
import { getTheme } from './themes';

/**
 * A stable marker the element sets on itself in `initialize()` (not the
 * constructor — see the comment there), regardless of what its tag name
 * happens to be. See `getElementName()` in `utils.ts` for why that can vary.
 * Everything that needs to find a terminal element (styles, keymaps, the
 * context menu, command scoping, `.closest()` lookups, the e2e tests) should
 * target this attribute instead of the tag name.
 *
 * This is needed at least temporarily so that an instance of this package can
 * be linked via `ppm` and shadow the builtin `terminal` package. It will no
 * longer be needed once Pulsar ships a version of `terminal` that does not
 * unconditionally register the `pulsar-terminal` element name at `require`
 * time.
 */
export const TERMINAL_ELEMENT_ATTRIBUTE = 'data-pulsar-terminal';

// TODO: Right now we're using `@electron/remote` as an explicit dependency;
// but when this becomes a builtin package, `@electron/remote` will be
// ambiently available. Better to use that without declaring it so as to avoid
// version clashes.
import { shell } from '@electron/remote';
import { getShellIntegrationInjection } from './shell-integration';
import { ShellIntegrationAddon } from './shell-integration/addon';
import { LocalPathLinkProvider } from './link-detection/provider';

/**
 * Given a line height and a font size, attempts to adjust the line height so
 * that it results in a pixel height that snaps to the nearest pixel (or
 * sub-pixel, taking device pixel ratio into account).
 *
 * In theory, this would be needed for synchronization with Pulsar, since the
 * editor code does something similar. In practice, though, line height values
 * seem to be applied differently in XTerm; a shared line-height value between
 * the editor and the terminal window results in much taller lines in the
 * terminal.
 */
function clampLineHeight (lineHeight: number, fontSize: number) {
  let lineHeightInPx = fontSize * lineHeight;
  let roundedScaledLineHeightInPx = Math.round(lineHeightInPx * window.devicePixelRatio);
  return roundedScaledLineHeightInPx / (fontSize * window.devicePixelRatio);
}

/**
 * Takes a DOM `KeyboardEvent` whose default was already prevented and creates
 * a fresh event so we can re-propagate it upward. This allows certain key
 * bindings and key sequences to keep working even if some of their events are
 * swallowed by xterm.js.
 */
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

interface TerminalLinkHandlerOptions {
  activate(event: MouseEvent, text: string, range?: IBufferRange): unknown;
  hover(event: MouseEvent, text: string, range?: IBufferRange | IViewportRange, rangeType?: 'buffer' | 'viewport'): unknown;
  leave(event: MouseEvent, text: string, range?: IBufferRange): unknown;
}

interface DelayedPresenceOptions<T> {
  /**
   * How long to wait in `pending-show` before transitioning to the `shown`
   * state.
   */
  showDelay?: number;
  /**
   * How long to wait in `pending-hide` before transitioning back to the `idle`
   * state.
   */
  hideDelay?: number;
  /**
   * Delay to use instead of `showDelay` when we're warm; defaults to `0`
   * (instant).
   */
  fastShowDelay?: number;
  /**
   * How recently we must have hidden something to count as "warm" and skip the
   * show delay; defaults to `showDelay`.
   */
  intentWindow?: number;
  /**
   * Function for detecting whether two keys are equal. Optional; will fall
   * back to equality check via `===`.
   */
  isSameKey?: (a: T, b: T) => boolean;

  /** What to execute as we transition from `pending-shown` to `shown`. */
  onShow: (key: T) => void;

  /** What to execute as we transition from `pending-hide` to `idle`. */
  onHide: (key: T) => void;
};

type DelayedPresenceState = 'idle' | 'pending-show' | 'shown' | 'pending-hide';

/**
 * A state machine that uses delays between state changes to guard against
 * rapid state fluctuation.
 *
 * Methods accept a key that scopes the state machine; this helps us know when
 * to reset the state machine and when to ignore stale requests to transition.
 *
 * We use this as a way of manually managing show/hide delays on tooltips.
 */
class DelayedPresence<T> {
  private state: DelayedPresenceState = 'idle';
  private currentKey?: T;
  private timer?: ReturnType<typeof setTimeout>;
  private lastHideAt?: number;

  private options: DelayedPresenceOptions<T>;

  constructor(options: DelayedPresenceOptions<T>) {
    this.options = options;
  }

  enter (key: T) {
    if (this.#inState('shown', 'pending-hide') && this.#isSame(key)) {
      // Same target re-entered before the hide timer fired; cancel it and stay
      // shown. This filters out spurious mouseout events.
      this.#cancelTimer();
      this.state = 'shown';
      return;
    }

    if (!this.#inState('idle')) {
      // Different target, or else same target still pending its first show.
      // Tear down whatever is in flight and start over.
      this.#reset();
    }

    this.currentKey = key;
    this.state = 'pending-show';

    let delay = this.#effectiveShowDelay();

    if (delay <= 0) {
      this.state = 'shown';
      this.options.onShow(key);
      return;
    }

    this.timer = setTimeout(() => {
      this.state = 'shown';
      this.options.onShow(key);
    }, this.options.showDelay ?? 0);
  }

  leave (key: T) {
    if (!this.#isSame(key)) {
      // A stale leave for a target we've already left.
      return;
    }

    this.#cancelTimer();

    if (this.#inState('pending-show')) {
      this.state = 'idle';
      this.currentKey = undefined;
      return;
    }

    if (this.#inState('shown')) {
      this.state = 'pending-hide';
      this.timer = setTimeout(() => {
        this.state = 'idle';
        this.lastHideAt = Date.now();
        this.options.onHide(key);
        this.currentKey = undefined;
      }, this.options.hideDelay ?? 0);
    }
  }

  dispose () {
    this.#reset();
  }

  // Like `dispose`, but only resets when the key matches.
  dismiss (key?: T) {
    if (key !== undefined && !this.#isSame(key)) return;
    this.#reset();
  }

  #inState (...states: DelayedPresenceState[]) {
    if (states.length === 1) {
      return this.state === states[0];
    }
    return states.some(s => this.state === s);
  }

  #isSame (key: T) {
    if (this.currentKey === undefined) return false;
    return this.options.isSameKey?.(key, this.currentKey) ?? key === this.currentKey;
  }

  #reset () {
    this.#cancelTimer();
    if (this.#inState('shown', 'pending-hide') && this.currentKey !== undefined) {
      this.lastHideAt = Date.now();
      this.options.onHide(this.currentKey);
    }
    this.state = 'idle';
    this.currentKey = undefined;
  }

  #effectiveShowDelay () {
    let showDelay = this.options.showDelay ?? 0;
    if (this.lastHideAt === undefined) return showDelay;

    let intentWindow = this.options.intentWindow ?? showDelay;
    let isWarm = (Date.now() - this.lastHideAt) < intentWindow;
    return isWarm ? (this.options.fastShowDelay ?? 0) : showDelay;
  }

  #cancelTimer () {
    if (this.timer) clearTimeout(this.timer);
    this.timer = undefined;
  }
}

type TooltipMetadata = {
  range: IBufferRange,
  rangeType?: 'buffer' | 'viewport'
  uri: string,
};

/**
 * A link handler class designed to fulfill both the interfaces related to link
 * handling (even though they differ from one another very slightly).
 */
class TerminalLinkHandler implements ILinkHandler {
  allowNonHttpProtocols = true;

  options: TerminalLinkHandlerOptions;

  constructor (options: TerminalLinkHandlerOptions) {
    this.options = options;
  }

  activate(event: MouseEvent, text: string, range: IBufferRange): void {
    this.activateWithOptionalRange(event, text, range);
  }

  hover(event: MouseEvent, text: string, range: IBufferRange): void {
    this.hoverWithOptionalRange(event, text, range, 'buffer');
  }

  leave(event: MouseEvent, text: string, range: IBufferRange): void {
    this.leaveWithOptionalRange(event, text, range);
  }

  activateWithOptionalRange (event: MouseEvent, text: string, range?: IBufferRange) {
    return this.options.activate(event, text, range);
  }

  hoverWithOptionalRange (event: MouseEvent, text: string, range?: IBufferRange | IViewportRange, rangeType?: 'buffer' | 'viewport') {
    return this.options.hover?.(event, text, range, rangeType);
  }

  leaveWithOptionalRange (event: MouseEvent, text: string, range?: IBufferRange) {
    return this.options.leave?.(event, text, range);
  }
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
  private restartingPromise?: Promise<void>;
  private findPalette?: FindPalette;

  // The bundle of subscriptions that manages all the transient items of a
  // tooltip: the marker, the decoration, and the tooltip itself.
  private tooltip?: CompositeDisposable;
  // The range for which we are currently showing a tooltip.
  private tooltipRange?: IBufferRange;

  private linkHandler: TerminalLinkHandler;
  private linkTooltip: DelayedPresence<TooltipMetadata>;

  // Object that holds the various elements.
  private div?: Record<'top' | 'main' | 'menu' | 'terminal' | 'palette', HTMLDivElement>;

  #mainResizeObserver?: ResizeObserver;
  #mainContentRect?: DOMRectReadOnly;
  #terminalIntersectionObserver?: IntersectionObserver | null;
  #terminalInitiallyVisible: boolean = false;
  #fitAddon?: FitAddon;
  #searchAddon?: SearchAddon;
  #shellIntegrationAddon?: ShellIntegrationAddon;
  #prioritizedPrefixes: string[] = [];

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
    return document.createElement(getElementName()) as TerminalElement;
  }

  constructor () {
    super();

    this.linkHandler = new TerminalLinkHandler({
      activate: (event, text, range) => this.activateLink(event, text, range),
      hover: (event, text, range) => this.hoverLink(event, text, range, 'buffer'),
      leave: (event, text, range) => this.leaveLink(event, text, range)
    });

    this.linkTooltip = new DelayedPresence<TooltipMetadata>({
      showDelay: atom.inSpecMode() ? 10 : 1000,
      hideDelay: atom.inSpecMode() ? 10 : 100,
      isSameKey: (a, b) => this.rangesAreEqual(a.range, b.range),
      onShow: ({ range, uri, rangeType }) => {
        return this.showHoverTooltip(range, uri, rangeType);
      },
      onHide: ({ range, uri }) => {
        return this.hideHoverTooltip(range, uri);
      }
    })
  }

  async initialize (model: TerminalModel) {
    // Not in the constructor: custom element constructors must not set
    // attributes on themselves (or have any other side effects beyond
    // `super()` and internal state setup) — Atom's `document-register-
    // element` compat shim enforces this strictly and throws
    // ("Failed to construct 'CustomElement': The result must not have
    // attributes") if violated. See the comment on `TERMINAL_ELEMENT_ATTRIBUTE`
    // above for what this is for.
    this.setAttribute(TERMINAL_ELEMENT_ATTRIBUTE, '');

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

          // Disconnect _before_ awaiting `createTerminal() in order to shut
          // down any possible race conditions.
          this.#terminalIntersectionObserver?.disconnect();
          this.#terminalIntersectionObserver = null;

          try {
            await this.createTerminal();
            initializeResolve();
          } catch (error) {
            initializeReject(error);
          }
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
        ),
        atom.config.observe(
          'terminal.behavior.prioritizedCommands',
          (newValue: string[]) => {
            this.#prioritizedPrefixes = newValue;
          }
        )
      );
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

  activateLink (event: MouseEvent, uri: string, _range?: IBufferRange) {
    if (Config.get('behavior.requireModifierToOpenUrls')) {
      let modifier = isMac() ? event.metaKey : event.ctrlKey;
      if (!modifier) {
        // Users get warned the first time they try to click a link without
        // holding a modifier… but only the first time.
        this.optionallyWarnAboutModifierlessClick();
        return;
      }
    }

    if (!uri.startsWith('file:')) {
      // This is a URL, most likely. Hand it off to the system for opening in
      // the user's default browser.
      shell.openExternal(uri);
      return;
    }


    // If we get this far, we're dealing with a file path. The way we respond
    // to various paths depends upon the user's configuration.
    const behavior = Config.get('behavior.localPathBehavior');
    const openDirectoriesInPulsar = behavior === 'all-pulsar';
    const openFilesInPulsar = behavior === 'all-pulsar' ||
      behavior === 'dir-explorer-file-pulsar';

    // Convert the `file://` URL to the format expected by Node APIs.
    let linkPath;
    try {
      linkPath = fileURLToPath(uri);
    } catch (err) {
      console.warn('[terminal] Did not open malformed URI because it did not resolve to a path:', uri);
      return;
    }

    // Nonexistent file paths don't have anything to handle.
    if (!fs.existsSync(linkPath)) return;

    // Decide what to do with this hyperlink based on configuration and
    // whether the link points to a file or a directory.
    let isDir = fs.lstatSync(linkPath).isDirectory();
    let shouldOpenInPulsar = isDir ? openDirectoriesInPulsar : openFilesInPulsar;
    if (shouldOpenInPulsar) {
      this.openInPulsar(uri, isDir);
    } else if (isDir) {
      // The behavior of `shell.openExternal` for a directory will open a
      // file explorer to the directory in question so the user can view its
      // contents.
      shell.openExternal(uri);
    } else {
      // We want to open the file's parent directory in the file explorer and
      // select this specific file.
      shell.showItemInFolder(linkPath);
    }
  }

  // Immediately create and display a tooltip over the given range that
  // contains the given URI.
  showHoverTooltip (range: IBufferRange | IViewportRange, uri: string, rangeType: 'buffer' | 'viewport' = 'buffer') {
    if (!this.terminal) return;

    // To create the decoration that serves as our tooltip anchor element,
    // we must first create a marker on the correct row. This marker is
    // placed relative to where the cursor is right now.
    let {
      // This seems to correlate to the row offset that the cursor has
      // _if_ the viewport is scrolled all the way to the bottom.
      cursorY,
      // This seems to correlate to how many lines are offscreen _if_ the
      // viewport is scrolled all the way to the bottom.
      baseY,
      viewportY
    } = this.terminal.buffer.active;

    // The meaning of `range.start.(y|x)` differs based on where the range came
    // from:
    //
    // * `IBufferRange` (OSC 8 links): 1-based index; absolute buffer position.
    // * `IViewportRange` (plain URLs via `WebLinksAddon`): 0-based index;
    //   relative to the current viewport's top row.
    //
    // `registerMarker`'s offset is always relative to the cursor's absolute
    // buffer position, so we have to convert into that target space.
    let markerY: number;
    let x: number;
    if (rangeType === 'viewport') {
      markerY = range.start.y + viewportY - baseY - cursorY;
      x = range.start.x;
    } else {
      markerY = range.start.y - (cursorY + baseY) - 1;
      x = range.start.x - 1;
    }

    Logger.debug(`Placed marker on row:`, markerY, 'given range starting at', range.start.y, 'and cursorY', cursorY, 'and baseY', baseY);

    let marker = this.terminal.registerMarker(markerY);
    let decoration = this.terminal.registerDecoration({
      x,
      marker,
      width: range.end.y === range.start.y ? (range.end.x - range.start.x + 1) : 1
    });

    // XTerm's documentation _claims_ to skip the registration of decorations
    // when we're on the alt buffer (used by, e.g., `less` and `vim` and `top`
    // and anything else complex enough to need the concept of a viewport and
    // its own management of a scroll buffer).
    //
    // Yet it _does not_ actually skip in this scenario! This is good for us;
    // it would be a lot harder to deliver hover tooltips without this
    // mechanism. The only caveat is that it does unconditionally set `display:
    // none` on all alt-buffer decorations rather than attempt to discern
    // whether they're present in the viewport. (It would not matter in our
    // case; this whole code path is triggered when a user mouses over a link,
    // so we can assume that the link is present in the viewport!)
    //
    // A reading of the source code and the design of the decoration system
    // suggests that this is a documentation bug rather than a code bug.
    // Nothing about this has changed in the XTerm 6.1.0 beta, and we expect
    // that it won't change in the future… but we do still guard against a lack
    // of decoration just in case!
    if (!decoration) return;

    this.tooltip = new CompositeDisposable();
    this.tooltip.add(new Disposable(() => {
      decoration?.dispose();
      marker?.dispose();
    }));

    let originalTooltip = this.tooltip;
    // `onRender` isn't a one-shot "first paint" hook — XTerm calls it again
    // on every subsequent repaint of this decoration (scroll, resize, cursor
    // blink, etc.), for as long as it stays registered. Without the
    // `tooltipAdded` guard below, each of those repaints would call
    // `atom.tooltips.add` again, stacking up duplicate tooltip instances on
    // the same element for a single hover.
    let tooltipAdded = false;
    decoration.onRender((elem) => {
      if (!this.terminal) return;

      // Guard against an old decoration trying to render.
      if (this.tooltip !== originalTooltip) return;

      // Explicitly remove any `none` value for `display` for the reasons
      // described above. If XTerm thinks this decoration should be hidden,
      // it's almost certainly wrong.
      elem.style.display = '';

      if (tooltipAdded) return;
      tooltipAdded = true;

      // All tooltip management is manual. We don't want to rely on a belief
      // that `element` is being hovered by the mouse pointer (that's not safe
      // to assume when a decoration spans multiple lines), so it's better to
      // opt into `trigger: 'manual'` and have the tooltip appear instantly.
      // The tooltip will be hidden later on by disposing the return value of
      // `atom.tooltips.add` — which we do automatically.
      //
      // This is not a big problem! The only downside of manual triggering is
      // that we lose built-in management of show/hide delay — but that's where
      // `DelayedPresence` steps in.
      this.tooltip?.add(atom.tooltips.add(elem, {
        title: uri,
        trigger: 'manual'
      }));
    });
  }

  // Immediately hide the active tooltip.
  hideHoverTooltip (_range: TooltipMetadata['range'], _uri: string) {
    this.tooltip?.dispose();
    this.tooltipRange = undefined;
  }

  // Called when the user hovers over a link; schedules the showing of a
  // tooltip.
  hoverLink (_event: MouseEvent, uri: string, range?: IBufferRange | IViewportRange, rangeType: 'buffer' | 'viewport' = 'buffer') {
    if (!this.terminal || !range) return;

    this.tooltipRange = range;

    // Upon first hover, we're prone to trigger a `leave` and an almost
    // immediate `hover`. This might be the result of temporary confusion after
    // the empty anchor element is created and placed underneath the mouse
    // pointer.
    //
    // But whatever the cause, it means we're doing a sort of debouncing here.
    // If we're in the second of two rapid calls to `hover`, then there will be
    // an existing tooltip we want to preserve. This is why we have the
    // infrastructure of `DelayedPresence` — to detect this case and keep a
    // reliable state in our state machine.
    this.linkTooltip.enter({ range, uri, rangeType });

    // TODO: Ideally, we would prevent the link from being underlined on hover
    // _if_ configuration is such that a modifier key must be held down to open
    // a link. To do this in XTerm.js, we'd have to implement our own link
    // provider _instead of_ WebLinksAddon, so this is annoying.
    //
    // It'd also only work for URLs in the terminal, not for OSC 8 links.
  }

  // Called when the user mouses away from a link; schedules the hiding of the
  // tooltip.
  leaveLink (_event: MouseEvent, uri: string, range?: IBufferRange) {
    // Ideally, we get called with a range; that lets us know whether this is
    // a fresh or stale request to hide the tooltip. But we'll fall back to the
    // current active tooltip range, if one exists.
    let operativeRange = range ?? this.tooltipRange;
    if (!operativeRange) return;

    // Trigger a delay-gated hiding of the tooltip. This will schedule the
    // hiding but cancel it if a mouseover happens again during the `hideDelay`
    // interval.
    this.linkTooltip.leave({ range: operativeRange, uri });
  }

  /**
   * Open the given URI within Pulsar.
   *
   * Exact behavior varies according to the user's configuration.
   */
  async openInPulsar (uri: string, isDirectory: boolean = false) {
    let linkPath = fileURLToPath(uri);
    let contains = atom.project.contains(linkPath);
    if (isDirectory) {
      if (!contains) {
        // TODO: Open a new project for this folder.
      } else {
        // We can't reveal this item in the tree view programmatically… yet!
        // But that is the goal.
      }
    } else {
      // Whether the path is within the project or outside of it, we'll open it
      // for editing in this window.
      await atom.workspace.open(linkPath);
    }
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

  #shouldPrioritizeBinding (kb: KeyBinding, ancestorChain?: HTMLElement[]) {
    let matchesPrioritizedPrefix = this.#prioritizedPrefixes.some(prefix => {
      if (prefix.endsWith(':')) return kb.command.startsWith(prefix);
      else return kb.command === prefix;
    });
    if (!matchesPrioritizedPrefix) return false;
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
  #keymapHasPendingPartialMatches () {
    // @ts-ignore Undocumented
    let partialMatches: KeyBinding[] | null = atom.keymaps.pendingPartialMatches;
    if (!partialMatches) return false;
    return partialMatches.some((kb) => this.#shouldPrioritizeBinding(kb));
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
  #keyboardEventMatchesKeybinding (event: KeyboardEvent) {
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

    let result = bindings.exactMatchCandidates.some((kb: KeyBinding) => this.#shouldPrioritizeBinding(kb, ancestorChain));

    if (result) {
      Logger.log('Assuming control of keybinding:', keystroke, 'because it matches at least one Pulsar binding');
    }
    return result;
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
      this.model.setCwd(undefined);
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

    // Metadata that helps distinguish this terminal for purposes of shell
    // integration. This allows users to add custom initialization logic inside
    // their own init scripts that targets our terminal specifically.
    env['TERM_PROGRAM'] = 'pulsar';
    env['TERM_PROGRAM_VERSION'] = atom.getVersion();

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
      overviewRuler: {
        width: 15,
        showTopBorder: true,
        showBottomBorder: true,
      },
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

  /**
   * Activates a path detected by `LocalPathLinkProvider`. `targetPath` is
   * already an absolute, filesystem-verified path (not a URI) by the time it
   * reaches this method; resolution and validation both happen in the
   * provider.
   */
  activateLocalPathLink (event: MouseEvent, targetPath: string, isDirectory: boolean, line?: number, column?: number) {
    if (Config.get('behavior.requireModifierToOpenUrls')) {
      let modifier = isMac() ? event.metaKey : event.ctrlKey;
      if (!modifier) {
        this.optionallyWarnAboutModifierlessClick();
        return;
      }
    }

    const behavior = Config.get('behavior.localPathBehavior');
    const openDirectoriesInExplorer = isDirectory && behavior !== 'all-pulsar';
    const openFilesInExplorer = !isDirectory && behavior === 'all-explorer';

    if (openDirectoriesInExplorer || openFilesInExplorer) {
      if (isDirectory) {
        shell.openPath(targetPath);
      } else {
        shell.showItemInFolder(targetPath);
      }
    } else if (line !== undefined) {
      // `initialLine`/`initialColumn` are 0-based; our parsed line/column
      // numbers are 1-based, as printed by the tool that produced them.
      atom.workspace.open(targetPath, {
        initialLine: line - 1,
        initialColumn: (column ?? 1) - 1
      });
    } else {
      atom.workspace.open(targetPath);
    }
  }

  /**
   * Instantiates a new terminal.
   *
   * Async; if a terminal creation is already in flight, subsequent calls will
   * return the promise tied to the existing terminal creation.
   */
  async createTerminal () {
    if (this.createdPromise) {
      return await this.createdPromise;
    }
    this.createdPromise = this.#createTerminal();
    this.createdPromise.finally(() => {
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

    let options: ITerminalOptions = {
      ...this.getXtermOptions(),
      allowProposedApi: true,
      linkHandler: this.linkHandler,
    };

    Logger.debug('Declaring new Terminal with options:', options);

    this.terminal = new XTerminal(options);

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
      if (this.#keymapHasPendingPartialMatches()) {
        redispatchKeyboardEvent(event.domEvent, this);
      }
    });

    this.#fitAddon = new FitAddon();
    this.terminal.loadAddon(this.#fitAddon);

    if (Config.get('xterm.webLinks')) {
      this.terminal.loadAddon(
        new WebLinksAddon(this.activateLink.bind(this), {
            hover: (event, text, location) => {
              this.linkHandler.hoverWithOptionalRange(event, text, location, 'viewport');
            },
            leave: this.linkHandler.leaveWithOptionalRange.bind(this.linkHandler)
          }
        )
      );
    }

    if (this.div) {
      this.terminal.open(this.div.terminal);
    }

    if (Config.get('xterm.webgl')) {
      let webglAddon: WebglAddon | null = null;
      try {
        webglAddon = new WebglAddon();
      } catch (err) {
        // The addon will throw on instantiation if a WebGL context cannot be
        // acquired.
        console.warn('terminal.xterm.webgl is true, but platform does not support WebGL');
      }
      if (webglAddon) {
        webglAddon.onContextLoss(() => webglAddon.dispose());
        this.terminal.loadAddon(webglAddon);
      }
    }

    if (Config.get('xterm.ligatures')) {
      this.terminal.loadAddon(new LigaturesAddon());
    }
    this.#searchAddon = new SearchAddon();
    this.terminal.loadAddon(this.#searchAddon);

    if (Config.get('terminal.enableShellIntegration')) {
      this.#shellIntegrationAddon = new ShellIntegrationAddon();
      this.terminal.loadAddon(this.#shellIntegrationAddon);
      this.subscriptions.add(
        this.#shellIntegrationAddon.onDidChangeCwd((cwd) => {
          Logger.debug('Shell integration: cwd changed:', cwd);
          if (this.model) this.model.setCwd(cwd);
        }),
        this.#shellIntegrationAddon.onDidExecuteCommand((command) => {
          Logger.debug('Shell integration: command executing:', command);
        }),
        this.#shellIntegrationAddon.onDidFinishCommand((command) => {
          Logger.debug('Shell integration: command finished:', command);
        })
      );
    }

    if (Config.get('xterm.localPathDetection')) {
      this.terminal.registerLinkProvider(
        new LocalPathLinkProvider(
          this.terminal,
          () => this.model?.getPath(),
          (event, targetPath, isDirectory, line, column) => this.activateLocalPathLink(event, targetPath, isDirectory, line, column)
        )
      );
    }

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
      if (this.#keyboardEventMatchesKeybinding(event)) {
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

  /**
   * Starts or restarts the PTY.
   *
   * Async; if a process restart is already in flight, subsequent calls will
   * return the promise tied to the existing restart.
   */
  async restartPtyProcess () {
    if (this.restartingPromise) {
      return await this.restartingPromise;
    }
    this.restartingPromise = this.#restartPtyProcess();
    this.restartingPromise.finally(() => {
      this.restartingPromise = undefined;
    });
    return await this.restartingPromise;
  }

  async #restartPtyProcess () {
    if (this.#ptyMeta?.running) {
      this.pty?.removeAllListeners('exit');
      this.pty?.kill();
      this.#ptyMeta.running = false;
    }

    let cwd = await this.getCwd();

    this.terminal?.reset();

    let command = this.getShellCommand();
    let args = this.getArgs();
    let env = this.getEnv();

    let result = await getShellIntegrationInjection(command, args, env);
    if (result.enabled) {
      Logger.debug('Shell integration injected:', result.injection);
      let injection = result.injection;
      env = { ...env, ...injection.env };
      args = injection.args;
      this.#shellIntegrationAddon?.setNonce(injection.env.PULSAR_TERMINAL_NONCE);
    } else {
      Logger.debug('Shell integration not injected:', result.reason);
      this.#shellIntegrationAddon?.setNonce(undefined);
    }

    this.#ptyMeta.options ??= {};
    this.#ptyMeta.command = command;
    this.#ptyMeta.args = args;

    let name = this.getTerminalType();
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

  pointsAreEqual (a: IBufferCellPosition, b: IBufferCellPosition) {
    return a.x === b.x && a.y === b.y;
  }

  rangesAreEqual (a: IBufferRange | undefined, b: IBufferRange | undefined) {
    if (!a || !b) return a === b;
    return this.pointsAreEqual(a.start, b.start) && this.pointsAreEqual(a.end, b.end);
  }

  inspectPoint (cell: IBufferCellPosition) {
    return `(${cell.x}, ${cell.y})`;
  }

  inspectRange (range: IBufferRange | undefined) {
    if (!range) return `(undefined)`;
    return `${this.inspectPoint(range.start)} - ${this.inspectPoint(range.end)}`;
  }
}

// Deliberately not called at module-load time. This module gets `require`d
// as part of Pulsar's package *preload* step for any bundled package (see
// `Package.prototype.preload()` in Pulsar core), which happens unconditionally
// for whichever copy of this package Pulsar ships bundled — independent of
// whether a dev-linked copy is what actually ends up activated. Since
// `customElements.define()` can never be called twice for the same tag name,
// defining it eagerly here would let whichever copy happens to load first
// (not necessarily the one that's actually activated) permanently win the
// registration. Call this from the package's `activate()` instead, which
// only ever runs for the package that's genuinely in use.
export function registerTerminalElement () {
  let name = getElementName();
  if (customElements.get(name)) return;
  customElements.define(name, TerminalElement);
}
