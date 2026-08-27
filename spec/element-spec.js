// const nodePty = require('node-pty');
const { shell } = require('@electron/remote');

const config = require('../lib/config');
const { getTheme } = require('../lib/themes');
const { TerminalElement } = require('../lib/element');
const { TerminalModel } = require('../lib/model');
const { Terminal } = require('@xterm/xterm');
const { Pty } = require('../lib/pty');
const { ShellIntegrationAddon } = require('../lib/shell-integration/addon');
const { getElementName } = require('../lib/utils');

const {
  activatePackage,
  wait,
  waitFor
} = require('./helpers');

const path = require('path');
const temp = require('temp');
temp.track();


let currentReadyIntervalMs = 100;

let createdElements = [];

function createMockStream (name) {
  let stream = jasmine.createSpyObj(name, ['on', 'write']);
  stream.pipe = () => {
    return stream;
  };
  return stream;
}

function createMockWorkerProcess () {
  workerProcess = jasmine.createSpyObj('workerProcess', [
    // 'on',
    'kill'
  ]);
  workerProcess.stdin = createMockStream('workerProcess.stdin');
  workerProcess.stdout = createMockStream('workerProcess.stdout');
  workerProcess.stderr = createMockStream('workerProcess.stderr');

  workerProcess.pid = 9;
  workerProcess._events = {};

  workerProcess.on = function (name, handler) {
    this._events[name] ??= [];
    this._events[name].push(handler);
  }

  workerProcess._trigger = function (name, ...args) {
    for (let handler of (this._events[name] ?? [])) {
      handler(...args);
    }
  };

  workerProcess._reset = function () {
    this._events = {};
  };
  return workerProcess;
}

describe('TerminalElement', () => {
  let savedPlatform = process.platform;
  let element, tmpdir, workerProcess;

  async function createElement (uri = `terminal://some-session-id/`) {
    let terminals = new Set();
    let model = new TerminalModel({ uri, terminals });
    await model.ready();
    model.pane = jasmine.createSpyObj('pane', [
      'removeItem',
      'getActiveItem',
      'destroyItem'
    ]);

    let terminalElement = TerminalElement.create();
    await terminalElement.initialize(model);
    await terminalElement.createTerminal();
    document.getElementById('jasmine-content').appendChild(terminalElement);
    createdElements.push(terminalElement);
    return terminalElement;
  }

  beforeEach(async () => {
    jasmine.useRealClock();
    await activatePackage();
    await atom.updateProcessEnvAndTriggerHooks();

    atom.config.set('terminal.behavior.promptOnStartup', false);
    // Turn off WebGL except for the specs that explicitly test it.
    atom.config.set('terminal.xterm.webgl', false);

    spyOn(Pty.prototype, 'spawn').andCallFake(() => {
      return createMockWorkerProcess();
    });
    spyOn(Pty.prototype, 'booted').andReturn(Promise.resolve());
    spyOn(Pty.prototype, 'ready').andReturn(Promise.resolve());
    spyOn(Pty.prototype, 'kill').andReturn(undefined);
    spyOn(shell, 'openExternal');
    element = await createElement();
    tmpdir = await temp.mkdir();

    // These specs trigger lots of creations and destructions of elements in a
    // short period of time. This can trigger distracting terminal errors as
    // idle callbacks run for elements that have been detached. This doesn't
    // affect the outcome, but it is still annoying.
    //
    // Introducing a brief pause in between specs helps avoid this.
    await wait(50);
  });

  afterEach(async () => {
    // Pause for a tick so that we're not creating and destroying this
    // element in the same frame.
    await wait(0);
    while (createdElements.length) {
      let el = createdElements.shift();
      el.destroy();
      if (el.parentNode) {
        el.parentNode.removeChild(el);
      }
    }
    Object.defineProperty(process, 'platform', {
      value: savedPlatform
    });
    await temp.cleanup();
  });

  it('initializes', () => {
    expect(element.terminal).toBeTruthy();
  });

  it('initializes with the correct session ID', () => {
    expect(element.getAttribute('session-id')).toBe('some-session-id');
  });

  // Exercises the exact path a real `atom.workspace.open()` uses, rather
  // than assuming it behaves identically to `TerminalElement.create()`
  // called directly.
  it('creates a working element via the registered view provider (atom.views.getView), not just via TerminalElement.create() directly', async () => {
    let terminals = new Set();
    let model = new TerminalModel({ uri: `terminal://view-provider-test/`, terminals });
    await model.ready();
    model.pane = jasmine.createSpyObj('pane', [
      'removeItem',
      'getActiveItem',
      'destroyItem'
    ]);

    let view = atom.views.getView(model);
    createdElements.push(view);

    expect(view).toBeTruthy();
    expect(typeof view.initialize).toBe('function');
  });

  // Bypasses both `TerminalElement.create()` and `atom.views.getView()` to
  // isolate whether the browser's own custom-element registry produces a
  // properly-upgraded element in this environment at all, independent of
  // whichever tag name `getElementName()` picked.
  it('produces a properly-upgraded element via document.createElement(getElementName()) directly', () => {
    let directElement = document.createElement(getElementName());
    createdElements.push(directElement);

    expect(typeof directElement.initialize).toBe('function');
    expect(directElement.constructor?.name).toBe('TerminalElement');
    expect(directElement.ownerDocument).toBe(document);
  });

  describe('destroy()', () => {
    it('kills the pty', () => {
      element.destroy();
      expect(element.pty.kill).toHaveBeenCalled();
    });

    it('destroys the terminal', () => {
      spyOn(element.terminal, 'dispose').andCallThrough();
      element.destroy();
      expect(element.terminal.dispose).toHaveBeenCalled();
    });

    it('disposes subscriptions', () => {
      spyOn(element.subscriptions, 'dispose').andCallThrough();
      element.destroy();
      expect(element.subscriptions.dispose).toHaveBeenCalled();
    });
  });

  describe('pathIsDirectory()', () => {
    it('returns false when path omitted', async () => {
      expect(await element.pathIsDirectory()).toBe(false);
    });

    it('returns false when path is undefined', async () => {
      expect(await element.pathIsDirectory(undefined)).toBe(false);
    });

    it('returns false when path is null', async () => {
      expect(await element.pathIsDirectory(null)).toBe(false);
    });

    it('returns false when path is nonexistent directory', async () => {
      let isDirectory = await element.pathIsDirectory(
        path.join(tmpdir, 'non-existent-dir')
      );
      expect(isDirectory).toBe(false);
    });

    it('returns true when path is temp directory', async () => {
      let isDirectory = await element.pathIsDirectory(tmpdir);
      expect(isDirectory).toBe(true);
    });
  });

  it('getCwd() returns the correct cwd', async () => {
    element.model.setCwd(tmpdir);
    expect(await element.getCwd()).toBe(tmpdir);
  });

  describe('createTerminal()', () => {
    it('creates a terminal object', () => {
      expect(element.terminal).toBeTruthy();
    });

    it('creates a pty instance', () => {
      expect(element.pty).toBeTruthy();
    });
  });

  describe('getEnv()', () => {
    let savedEnv;

    beforeEach(() => {
      savedEnv = { ...process.env };
      atom.config.set('terminal.terminal.env.fallbackEnv', '{}');
      atom.config.set('terminal.terminal.env.overrideEnv', '{}');
      atom.config.set('terminal.terminal.env.deleteEnv', []);
    });

    afterEach(() => {
      for (let key of Object.keys(process.env)) {
        delete process.env[key];
      }
      Object.assign(process.env, savedEnv);
    });

    // Deliberately does not use `TERM_PROGRAM`/`TERM_PROGRAM_VERSION`: those
    // are stripped and then re-declared as our own, so they can't show that
    // stripping happened. See the `TERM_PROGRAM` spec below.
    it('strips variables on the compulsory deny-list', () => {
      process.env.ITERM_SESSION_ID = 'w0t0p0:1234';
      process.env.TMUX = '/tmp/tmux-501/default,1,0';
      process.env.SSH_TTY = '/dev/ttys004';

      let env = element.getEnv();

      expect(env.ITERM_SESSION_ID).toBeUndefined();
      expect(env.TMUX).toBeUndefined();
      expect(env.SSH_TTY).toBeUndefined();
    });

    it('declares TERM_PROGRAM as its own, overwriting whatever was inherited', () => {
      process.env.TERM_PROGRAM = 'iTerm.app';
      process.env.TERM_PROGRAM_VERSION = '3.5.0';

      let env = element.getEnv();

      expect(env.TERM_PROGRAM).toBe('pulsar');
      expect(env.TERM_PROGRAM_VERSION).toBe(atom.getVersion());
    });

    // The canary for an over-broad deny-list: strip too much and you get a
    // terminal that can't find `ls`, which no other spec would notice.
    it('leaves ordinary inherited variables alone', () => {
      process.env.PATH = '/usr/bin:/bin';
      process.env.HOME = '/Users/nobody';
      process.env.LANG = 'en_US.UTF-8';
      process.env.SSH_AUTH_SOCK = '/private/tmp/agent.sock';

      let env = element.getEnv();

      expect(env.PATH).toBe('/usr/bin:/bin');
      expect(env.HOME).toBe('/Users/nobody');
      expect(env.LANG).toBe('en_US.UTF-8');
      expect(env.SSH_AUTH_SOCK).toBe('/private/tmp/agent.sock');
    });

    it('lets overrideEnv reinstate a variable from the compulsory deny-list', () => {
      process.env.TMUX = '/tmp/tmux-501/default,1,0';
      atom.config.set(
        'terminal.terminal.env.overrideEnv',
        JSON.stringify({ TMUX: '/tmp/tmux-501/default,9,9' })
      );

      expect(element.getEnv().TMUX).toBe('/tmp/tmux-501/default,9,9');
    });

    // The declaration sits before the overrides, so posing as another terminal
    // remains possible for anyone who needs it.
    it('lets overrideEnv change the declared TERM_PROGRAM', () => {
      atom.config.set(
        'terminal.terminal.env.overrideEnv',
        JSON.stringify({ TERM_PROGRAM: 'iTerm.app' })
      );

      expect(element.getEnv().TERM_PROGRAM).toBe('iTerm.app');
    });

    // Pins the ordering: `deleteEnv` runs last, so it beats `overrideEnv`,
    // whereas the compulsory list runs first and loses to it.
    it('does not let overrideEnv reinstate a variable from deleteEnv', () => {
      process.env.SOME_VARIABLE = 'inherited';
      atom.config.set('terminal.terminal.env.deleteEnv', ['SOME_VARIABLE']);
      atom.config.set(
        'terminal.terminal.env.overrideEnv',
        JSON.stringify({ SOME_VARIABLE: 'overridden' })
      );

      expect(element.getEnv().SOME_VARIABLE).toBeUndefined();
    });

    it('keeps contingent variables when APPIMAGE is absent', () => {
      delete process.env.APPIMAGE;
      process.env.LD_LIBRARY_PATH = '/opt/lib';
      process.env.ARGV0 = 'zsh';
      process.env.OWD = '/home/nobody';

      let env = element.getEnv();

      expect(env.LD_LIBRARY_PATH).toBe('/opt/lib');
      expect(env.ARGV0).toBe('zsh');
      expect(env.OWD).toBe('/home/nobody');
    });

    it('strips contingent variables — and the trigger — when APPIMAGE is present', () => {
      process.env.APPIMAGE = '/opt/Pulsar.AppImage';
      process.env.APPDIR = '/tmp/.mount_pulsar';
      process.env.LD_LIBRARY_PATH = '/tmp/.mount_pulsar/usr/lib';
      process.env.ARGV0 = 'zsh';
      process.env.OWD = '/home/nobody';

      let env = element.getEnv();

      expect(env.APPIMAGE).toBeUndefined();
      expect(env.APPDIR).toBeUndefined();
      expect(env.LD_LIBRARY_PATH).toBeUndefined();
      expect(env.ARGV0).toBeUndefined();
      expect(env.OWD).toBeUndefined();
    });

    // `APPIMAGE=` is unlikely, but `LD_LIBRARY_PATH=` is a real idiom, so the
    // trigger is tested for presence rather than truthiness.
    it('treats an empty APPIMAGE as present', () => {
      process.env.APPIMAGE = '';
      process.env.LD_LIBRARY_PATH = '/tmp/.mount_pulsar/usr/lib';

      expect(element.getEnv().LD_LIBRARY_PATH).toBeUndefined();
    });

    it('uses fallbackEnv only for variables that were not inherited', () => {
      process.env.EXISTING_VARIABLE = 'inherited';
      delete process.env.MISSING_VARIABLE;
      atom.config.set(
        'terminal.terminal.env.fallbackEnv',
        JSON.stringify({
          EXISTING_VARIABLE: 'fallback',
          MISSING_VARIABLE: 'fallback'
        })
      );

      let env = element.getEnv();

      expect(env.EXISTING_VARIABLE).toBe('inherited');
      expect(env.MISSING_VARIABLE).toBe('fallback');
    });

    it('declares COLORTERM, but lets the user override it', () => {
      process.env.COLORTERM = '';
      expect(element.getEnv().COLORTERM).toBe('truecolor');

      atom.config.set(
        'terminal.terminal.env.overrideEnv',
        JSON.stringify({ COLORTERM: '256' })
      );
      expect(element.getEnv().COLORTERM).toBe('256');
    });
  });

  describe('getExtraXTermOptions()', () => {
    it('passes along values defined in the package config', () => {
      atom.config.set('terminal.xterm.additionalOptions', `{ "foo": false }`);
      expect(element.getExtraXTermOptions()).toEqual({ foo: false });
    });

    it('notifies the user when the config field is invalid JSON', () => {
      spyOn(atom.notifications, 'addError').andCallThrough();
      atom.config.set('terminal.xterm.additionalOptions', `{ "foo": false`);
      expect(element.getExtraXTermOptions()).toEqual({});
      expect(atom.notifications.addError).toHaveBeenCalled();
    });
  });

  describe('createTerminal() addon', () => {
    const { WebLinksAddon } = require('@xterm/addon-web-links');
    const { WebglAddon } = require('@xterm/addon-webgl');

    beforeEach(() => {
      spyOn(Terminal.prototype, 'loadAddon').andCallThrough();
    });

    afterEach(() => {
      Terminal.prototype.loadAddon.reset();
    });

    describe('web-links', () => {
      it('is enabled if configured as such', async () => {
        atom.config.set('terminal.xterm.webLinks', true);
        await createElement();
        let wasAdded = Terminal.prototype.loadAddon.calls.some((call) => {
          return call.args[0] instanceof WebLinksAddon;
        });
        expect(wasAdded).toBe(true);
      })

      it('is disabled if configured as such', async () => {
        atom.config.set('terminal.xterm.webLinks', false);
        await createElement();
        let wasAdded = Terminal.prototype.loadAddon.calls.some((call) => {
          return call.args[0] instanceof WebLinksAddon;
        });
        expect(wasAdded).toBe(false);
      });
    });

    describe('webgl', () => {
      it('is enabled if configured as such', async () => {
        atom.config.set('terminal.xterm.webgl', true);
        await createElement();
        let wasAdded = Terminal.prototype.loadAddon.calls.some((call) => {
          return call.args[0] instanceof WebglAddon;
        });
        expect(wasAdded).toBe(true);
      })

      it('is disabled if configured as such', async () => {
        atom.config.set('terminal.xterm.webgl', false);
        await createElement();
        let wasAdded = Terminal.prototype.loadAddon.calls.some((call) => {
          return call.args[0] instanceof WebglAddon;
        });
        expect(wasAdded).toBe(false);
      });
    });
  });

  describe('restartPtyProcess()', () => {
    beforeEach(() => {
      currentReadyIntervalMs = 10;
    });

    it('creates a new pty instance', async () => {
      let oldPty = element.pty;
      await element.restartPtyProcess();
      expect(element.pty).not.toBe(oldPty);
    });

    it('sets the "running" flag to true', async () => {
      expect(element.isPtyProcessRunning()).toBe(true);
      let promise = element.restartPtyProcess();
      expect(element.isPtyProcessRunning()).toBe(false);
      await promise;
      expect(element.isPtyProcessRunning()).toBe(true);
    });

    // This one is strange because I can't get `spawn` in `node-pty` to return
    // any sort of error with a nonexistent command. Putting this aside for
    // now.
    xit('handles a nonexistent command', async () => {
      currentReadyIntervalMs = 500;
      spyOn(atom.notifications, 'addError');
      atom.config.set('terminal.terminal.shell', 'somecommand');
      let restartPromise = element.restartPtyProcess();
      await wait(10);
      try {
        await restartPromise;
      } catch {
      } finally {
        // Give the element time to act.
        await wait(10);
        expect(element.pty).toBe(undefined);
        expect(atom.notifications.addError).toHaveBeenCalled();
      }
    });
  });

  describe('activateLink()', () => {
    it('does nothing without the modifier key when one is required', () => {
      atom.config.set('terminal.behavior.requireModifierToOpenUrls', true);
      let event = new MouseEvent('click', { metaKey: false, ctrlKey: false });
      element.activateLink(event, 'https://example.com');
      expect(shell.openExternal).not.toHaveBeenCalled();
    });

    it('opens a non-file URI externally when the modifier is held', () => {
      atom.config.set('terminal.behavior.requireModifierToOpenUrls', true);
      let event = new MouseEvent('click', { metaKey: true, ctrlKey: true });
      element.activateLink(event, 'https://example.com');
      expect(shell.openExternal).toHaveBeenCalledWith('https://example.com');
    });

    it('does nothing for a file:// URI that does not exist on disk', () => {
      atom.config.set('terminal.behavior.requireModifierToOpenUrls', false);
      spyOn(shell, 'showItemInFolder');
      let event = new MouseEvent('click');
      element.activateLink(event, 'file:///nonexistent/path/does-not-exist');
      expect(shell.openExternal).not.toHaveBeenCalled();
      expect(shell.showItemInFolder).not.toHaveBeenCalled();
    });

    it('opens a directory externally (when `dir-explorer-file-pulsar` is configured)', () => {
      atom.config.set('terminal.behavior.requireModifierToOpenUrls', false);
      atom.config.set('terminal.behavior.hyperlinkPathBehavior', 'dir-explorer-file-pulsar');
      let uri = require('url').pathToFileURL(tmpdir).toString();
      let event = new MouseEvent('click');
      element.activateLink(event, uri);
      expect(shell.openExternal).toHaveBeenCalledWith(uri);
    });

    it('reveals an existing file in the file explorer (when configured)', async () => {
      let filePath = path.join(tmpdir, 'example.txt');
      require('fs-extra').writeFileSync(filePath, 'hi');
      spyOn(shell, 'showItemInFolder');
      atom.config.set('terminal.behavior.requireModifierToOpenUrls', false);
      atom.config.set('terminal.behavior.hyperlinkPathBehavior', 'all-explorer');
      let uri = require('url').pathToFileURL(filePath).toString();
      element.activateLink(new MouseEvent('click'), uri);
      // `shell.showItemInFolder` expects a plain filesystem path, not a
      // `file://` URI — passing the URI through unconverted would open (or
      // silently fail to open) the wrong thing depending on platform.
      expect(shell.showItemInFolder).toHaveBeenCalledWith(filePath);
    });
    it('opens an existing file in Pulsar (when configured)', async () => {
      let filePath = path.join(tmpdir, 'example.txt');
      require('fs-extra').writeFileSync(filePath, 'hi');
      spyOn(atom.workspace, 'open');
      atom.config.set('terminal.behavior.requireModifierToOpenUrls', false);
      atom.config.set('terminal.behavior.hyperlinkPathBehavior', 'dir-explorer-file-pulsar');
      let uri = require('url').pathToFileURL(filePath).toString();
      element.activateLink(new MouseEvent('click'), uri);
      expect(atom.workspace.open).toHaveBeenCalled();
    });
  });

  describe('hoverLink() / leaveLink()', () => {
    // This behavior is hard to test! We do it by constructing artificial
    // ranges that XTerm.js understands. (Its "range" data structure is similar
    // to ours, but not identical.)
    //
    // If these tests prove to be too fragile and too dependent on
    // implementation details, we can convert them to a less finicky approach
    // that just asserts `atom.tooltips.add` was called.
    function makeTerminalRange (startX, startY, endX, endY) {
      return { start: { x: startX, y: startY }, end: { x: endX, y: endY } };
    }

    it('creates a tooltip on hover', () => {
      spyOn(atom.tooltips, 'add').andCallThrough();
      let range = makeTerminalRange(1, 1, 5, 1);
      element.hoverLink(new MouseEvent('mouseover'), 'file:///foo', range);
      expect(element.tooltipRange).toEqual(range);
    });

    it('reuses the existing tooltip when hovering the same range twice in a row', () => {
      let range = makeTerminalRange(1, 1, 5, 1);
      element.hoverLink(new MouseEvent('mouseover'), 'file:///foo', range);
      let firstTooltip = element.tooltip;
      element.leaveLink(new MouseEvent('mouseout'), 'file:///foo', range);
      element.hoverLink(new MouseEvent('mouseover'), 'file:///foo', range);
      expect(element.tooltip).toBe(firstTooltip);
    });

    it('creates a new tooltip when the range changes', async () => {
      let rangeA = makeTerminalRange(1, 1, 5, 1);
      let rangeB = makeTerminalRange(1, 2, 5, 2);
      element.hoverLink(new MouseEvent('mouseover'), 'file:///foo', rangeA);
      await waitFor(() => !!element.tooltip);
      let firstTooltip = element.tooltip;
      element.hoverLink(new MouseEvent('mouseover'), 'file:///bar', rangeB);
      await waitFor(() => !!element.tooltip);
      expect(element.tooltip).not.toBe(firstTooltip);
    });

    it('disposes the tooltip after leaving, once the hide delay elapses', async () => {
      jasmine.useRealClock();
      let range = makeTerminalRange(1, 1, 5, 1);
      element.hoverLink(new MouseEvent('mouseover'), 'file:///foo', range);
      await waitFor(() => !!element.tooltip);
      let tooltip = element.tooltip;
      spyOn(tooltip, 'dispose').andCallThrough();
      element.leaveLink(new MouseEvent('mouseout'), 'file:///foo', range);
      await wait(150); // longer than the 100ms hide delay
      expect(tooltip.dispose).toHaveBeenCalled();
    });

    it('cancels the pending removal if the mouse re-enters the same link before the hide delay elapses', async () => {
      let range = makeTerminalRange(1, 1, 5, 1);
      let disposable = jasmine.createSpyObj('disposable', ['dispose']);
      spyOn(atom.tooltips, 'add').andReturn(disposable);

      element.hoverLink(new MouseEvent('mouseover'), 'file:///foo', range);
      await waitFor(() => atom.tooltips.add.callCount > 0);

      element.leaveLink(new MouseEvent('mouseout'), 'file:///foo', range);
      // Same range: should cancel the pending hide.
      element.hoverLink(new MouseEvent('mouseover'), 'file:///foo', range);

      await wait(200);
      expect(disposable.dispose).not.toHaveBeenCalled();
      expect(atom.tooltips.add.callCount).toBe(1);
    });
  });

  describe('rangesAreEqual()', () => {
    it('is true for two undefined ranges', () => {
      expect(element.rangesAreEqual(undefined, undefined)).toBe(true);
    });
    it('is false when only one side is undefined', () => {
      let range = { start: { x: 1, y: 1 }, end: { x: 2, y: 1 } };
      expect(element.rangesAreEqual(range, undefined)).toBe(false);
    });
    it('is true for ranges with identical start/end points', () => {
      let a = { start: { x: 1, y: 1 }, end: { x: 2, y: 1 } };
      let b = { start: { x: 1, y: 1 }, end: { x: 2, y: 1 } };
      expect(element.rangesAreEqual(a, b)).toBe(true);
    });
    it('is false when points differ', () => {
      let a = { start: { x: 1, y: 1 }, end: { x: 2, y: 1 } };
      let b = { start: { x: 1, y: 1 }, end: { x: 3, y: 1 } };
      expect(element.rangesAreEqual(a, b)).toBe(false);
    });
  });

  describe('shell integration', () => {
    const shellIntegrationModule = require('../lib/shell-integration');
    const FAKE_NONCE = 'test-nonce';

    async function write (terminal, data) {
      return new Promise((resolve) => terminal.write(data, resolve));
    }

    // The addon is loaded via `terminal.loadAddon(...)`, same as the
    // WebLinks/WebGL addons above, so this is the only way to get at the
    // real instance without reaching into `TerminalElement`'s private
    // `#shellIntegrationAddon` field (which, being a true private field,
    // isn't reachable from spec code at all).
    function findShellIntegrationAddon () {
      let matchingCall = Terminal.prototype.loadAddon.calls.find(
        (call) => call.args[0] instanceof ShellIntegrationAddon
      );
      return matchingCall?.args[0];
    }

    beforeEach(() => {
      spyOn(Terminal.prototype, 'loadAddon').andCallThrough();
      // The shell on this machine (or CI's) might be bash, zsh, fish, or
      // pwsh, and `getShellIntegrationInjection` does real, sometimes slow
      // filesystem work (see `shell-integration-spec.js`, which already
      // covers that logic directly, per-shell). None of that is relevant
      // here — these specs are only about how `TerminalElement` wires the
      // result into the addon — so it's stubbed to something fast and
      // deterministic instead.
      spyOn(shellIntegrationModule, 'getShellIntegrationInjection').andReturn(Promise.resolve({
        enabled: true,
        injection: {
          args: [],
          env: { PULSAR_TERMINAL_INJECTION: '1', PULSAR_TERMINAL_NONCE: FAKE_NONCE }
        }
      }));
    });

    afterEach(() => {
      Terminal.prototype.loadAddon.reset();
    });

    it('loads the addon when shell integration is enabled', async () => {
      atom.config.set('terminal.terminal.enableShellIntegration', true);
      await createElement();
      expect(findShellIntegrationAddon()).toBeTruthy();
    });

    it('does not load the addon when shell integration is disabled', async () => {
      atom.config.set('terminal.terminal.enableShellIntegration', false);
      await createElement();
      expect(findShellIntegrationAddon()).toBeUndefined();
    });

    it("updates the model's cwd when the terminal receives an OSC 633 Cwd sequence", async () => {
      atom.config.set('terminal.terminal.enableShellIntegration', true);
      let localElement = await createElement();
      await write(localElement.terminal, `\x1b]633;P;Cwd=${tmpdir}\x07`);
      expect(localElement.model.cwd).toBe(tmpdir);
    });

    it("leaves the model's cwd alone when shell integration is disabled", async () => {
      atom.config.set('terminal.terminal.enableShellIntegration', false);
      let localElement = await createElement();
      let cwdBefore = localElement.model.cwd;
      // With the addon never loaded, xterm has no OSC 633 handler at all, so
      // this sequence goes wholly unhandled rather than being caught and
      // ignored by us.
      await write(localElement.terminal, `\x1b]633;P;Cwd=${tmpdir}\x07`);
      expect(localElement.model.cwd).toBe(cwdBefore);
    });

    it('gives the addon the nonce from the injection result, gating command-line attribution', async () => {
      atom.config.set('terminal.terminal.enableShellIntegration', true);
      let localElement = await createElement();

      let addonInstance = findShellIntegrationAddon();
      let spy = jasmine.createSpy('execute-spy');
      addonInstance.onDidExecuteCommand(spy);

      await write(localElement.terminal, `\x1b]633;E;npm test;${FAKE_NONCE}\x07`);
      await write(localElement.terminal, '\x1b]633;C\x07');

      expect(spy.calls[0].args[0].commandLine).toBe('npm test');
    });

    it('does not attribute a command line reported under a stale nonce', async () => {
      atom.config.set('terminal.terminal.enableShellIntegration', true);
      let localElement = await createElement();

      let addonInstance = findShellIntegrationAddon();
      let spy = jasmine.createSpy('execute-spy');
      addonInstance.onDidExecuteCommand(spy);

      await write(localElement.terminal, '\x1b]633;E;npm test;not-the-real-nonce\x07');
      await write(localElement.terminal, '\x1b]633;C\x07');

      expect(spy.calls[0].args[0].commandLine).toBeUndefined();
    });
  });
});
