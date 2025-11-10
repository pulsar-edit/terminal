const nodePty = require('node-pty');
const { shell } = require('@electron/remote');

const config = require('../lib/config');
const { getTheme } = require('../lib/themes');
const { TerminalElement } = require('../lib/element');
const { TerminalModel } = require('../lib/model');
const { Terminal } = require('@xterm/xterm');
const { Pty } = require('../lib/pty');

const {
  activatePackage,
  wait
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

    atom.config.set('terminal.behavior.promptOnStartup', false);


    let ptyProcess = jasmine.createSpyObj('ptyProcess', [
      'kill',
      'write',
      'resize',
      'on',
      'removeAllListeners'
    ]);
    ptyProcess.title = 'some-test-process';
    spyOn(Pty.prototype, 'spawn').andCallFake(() => {
      return createMockWorkerProcess();
    });
    spyOn(Pty.prototype, 'booted').andReturn(Promise.resolve());
    spyOn(Pty.prototype, 'ready').andReturn(Promise.resolve());
    spyOn(Pty.prototype, 'kill').andReturn(undefined);
    spyOn(shell, 'openExternal');
    element = await createElement();
    tmpdir = await temp.mkdir();
  });

  afterEach(async () => {
    while (createdElements.length) {
      let el = createdElements.shift();
      console.log('Destroying element', el.uid, 'with PID:', el.pty?.id);
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
    element.model.cwd = tmpdir;
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

  describe('createTerminal() addon', () => {
    const { WebLinksAddon } = require('@xterm/addon-web-links');
    const { WebglAddon } = require('@xterm/addon-webgl');

    beforeEach(() => {
      spyOn(Terminal.prototype, 'loadAddon').andCallThrough();
      console.log('Spied on loadAddon:', Terminal.prototype.loadAddon);
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
      atom.config.set('terminal.terminal.command', 'somecommand');
      let restartPromise = element.restartPtyProcess();
      await wait(10);
      try {
        await restartPromise;
      } catch {
        console.warn('AHA!');
      } finally {
        // Give the element time to act.
        await wait(10);
        expect(element.pty).toBe(undefined);
        expect(atom.notifications.addError).toHaveBeenCalled();
      }
    });
  });
});
