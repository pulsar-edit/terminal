const Terminal = require('../lib/terminal');
const { URL } = require('url');

const {
  activatePackage,
  wait
} = require('./helpers');

const DIV = document.createElement('div');

describe('Terminal', () => {
  beforeEach(() => {
    jasmine.useRealClock();
    document.getElementById('jasmine-content').style.height = '150px';
    activatePackage();
  });

  describe('unfocus()', () => {
    it('focuses atom-workspace', async () => {
      jasmine.attachToDOM(atom.views.getView(atom.workspace));
      let model = await Terminal.openInCenterOrDock(atom.workspace);
      await model.ready();
      await model.element.createTerminal();
      // Give the terminal time to start up.
      await wait(500);
      expect(model.element.contains(document.activeElement)).toEqual(true);
      Terminal.unfocus();
      // debugger;
      expect(model.element.contains(document.activeElement)).toEqual(false);
      model.destroy();
    });
  });

  describe('runCommands()', () => {
    let activeTerminal, newTerminal, commands;
    beforeEach(() => {
      activeTerminal = {
        element: {
          ready: () => Promise.resolve()
        },
        run: jasmine.createSpy('activeTerminal.run')
      };
      commands = ['command 1', 'command 2'];
      newTerminal = {
        element: {
          ready: () => Promise.resolve()
        },
        run: jasmine.createSpy('newTerminal.run')
      };
      spyOn(Terminal, 'getActiveTerminal').andReturn(activeTerminal);
      spyOn(Terminal, 'open').andReturn(newTerminal);
    });

    it('runs commands in a new terminal if configured to do so', async () => {
      atom.config.set('terminal.behavior.runInActive', false);
      await Terminal.runCommands(commands);
      expect(Terminal.getActiveTerminal).not.toHaveBeenCalled();
      expect(newTerminal.run).toHaveBeenCalledWith('command 1');
      expect(newTerminal.run).toHaveBeenCalledWith('command 2');
    });

    it('runs commands in the active terminal if configured to do so', async () => {
      atom.config.set('terminal.behavior.runInActive', true);
      await Terminal.runCommands(commands);
      expect(Terminal.open).not.toHaveBeenCalled();
      expect(activeTerminal.run).toHaveBeenCalledWith('command 1');
      expect(activeTerminal.run).toHaveBeenCalledWith('command 2');
    });

    it('creates a new terminal if need be, even if configured to reuse terminals', async () => {
      Terminal.getActiveTerminal.andReturn()
      atom.config.set("terminal.behavior.runInActive", true)
      await Terminal.runCommands(commands);

      expect(Terminal.getActiveTerminal).toHaveBeenCalled();
      expect(newTerminal.run).toHaveBeenCalledWith("command 1");
      expect(newTerminal.run).toHaveBeenCalledWith("command 2");
    });
  });

  describe('terminal proxy methods', () => {
    let activeTerminal;
    beforeEach(() => {
      activeTerminal = {
        element: {
          ready: () => Promise.resolve()
        },
        exit: jasmine.createSpy('activeTerminal.exit'),
        restartPtyProcess: jasmine.createSpy('activeTerminal.restartPtyProcess'),
        getSelection: jasmine.createSpy('activeTerminal.copy').andReturn('copied'),
        paste: jasmine.createSpy('activeTerminal.paste'),
        clear: jasmine.createSpy('activeTerminal.clear')
      };
      spyOn(Terminal, 'getActiveTerminal').andReturn(activeTerminal);
    });

    describe('close()', () => {
      it('closes the active terminal', async () => {
        await Terminal.close();
        expect(activeTerminal.exit).toHaveBeenCalled();
      });
    });

    describe('restart()', () => {
      it('restarts the terminal', async () => {
        await Terminal.restart();
        expect(activeTerminal.restartPtyProcess).toHaveBeenCalled();
      });
    });

    describe('copy()', () => {
      it('copies text from the active terminal', async () => {
        spyOn(atom.clipboard, 'write');
        await Terminal.copy();
        expect(atom.clipboard.write).toHaveBeenCalledWith('copied');
      });
    });

    describe('paste()', () => {
      it('pastes text into the active terminal', async () => {
        spyOn(atom.clipboard, 'read').andReturn('copied');
        await Terminal.paste();
        expect(activeTerminal.paste).toHaveBeenCalledWith('copied');
      });
    });

    describe('clear()', () => {
      it('clears the active terminal', async () => {
        await Terminal.clear();
        expect(activeTerminal.clear).toHaveBeenCalled();
      });
    });
  });

  describe('open()', () => {
    let uri;
    beforeEach(() => {
      uri = Terminal.generateUri();
      spyOn(atom.workspace, 'open');
    });

    it('handles a simple case', async () => {
      await Terminal.open(uri);
      expect(atom.workspace.open).toHaveBeenCalledWith(uri, {});
    });

    it('specifies a cwd if a target is given', async () => {
      let testPath = `/test/path`;
      spyOn(Terminal, 'getPath').andReturn(testPath);
      // `cwd` is appended to the URL, but only if the target is an element.
      // TODO: Does what I just said make any sense?
      await Terminal.open(uri, { target: DIV });

      let url = new URL(atom.workspace.open.calls[0].args[0]);
      expect(url.searchParams.get('cwd')).toBe(testPath);
    });
  });
});
