const Terminal = require('../lib/terminal');
const { TERMINAL_ELEMENT_ATTRIBUTE } = require('../lib/element');
const { URL } = require('url');
const { PACKAGE_NAME } = require('../lib/utils');

const {
  activatePackage,
  wait
} = require('./helpers');

const DIV = document.createElement('div');

describe('Terminal', () => {
  beforeEach(async () => {
    jasmine.useRealClock();
    document.getElementById('jasmine-content').style.height = '150px';
    activatePackage();
    await atom.updateProcessEnvAndTriggerHooks();
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
      expect(model.element.contains(document.activeElement)).toEqual(false);
      model.destroy();
    });
  });

  describe('focus tracking', () => {
    let workspaceElement;

    beforeEach(async () => {
      await activatePackage();
      workspaceElement = atom.views.getView(atom.workspace);
      jasmine.attachToDOM(workspaceElement);
      Terminal.previousFocus = null;
    });

    afterEach(() => {
      Terminal.previousFocus = null;
    });

    // Builds a stand-in for a terminal element. `describeFocus` only looks for
    // the marker attribute, so this exercises the same branch as a real
    // terminal without paying for a pty and an xterm boot.
    function createFakeTerminal () {
      let fake = document.createElement('div');
      fake.setAttribute(TERMINAL_ELEMENT_ATTRIBUTE, '');
      let inner = document.createElement('input');
      fake.appendChild(inner);
      workspaceElement.appendChild(fake);
      return { fake, inner };
    }

    function createStrayElement () {
      let stray = document.createElement('input');
      workspaceElement.appendChild(stray);
      return stray;
    }

    describe('describeFocus()', () => {
      it('ignores targets that are not elements', () => {
        expect(Terminal.describeFocus(null)).toBe(null);
        expect(Terminal.describeFocus(window)).toBe(null);
      });

      it('ignores focus that originates inside a terminal', () => {
        let { inner } = createFakeTerminal();
        expect(Terminal.describeFocus(inner)).toBe(null);
      });

      it('describes focus inside a pane item as that item', async () => {
        let editor = await atom.workspace.open();
        let result = Terminal.describeFocus(atom.views.getView(editor));
        expect(result.type).toBe('item');
        expect(result.item).toBe(editor);
      });

      it('describes focus outside any pane item as a bare element', () => {
        let stray = createStrayElement();
        let result = Terminal.describeFocus(stray);
        expect(result.type).toBe('element');
        expect(result.element).toBe(stray);
      });
    });

    describe('the focusin listener', () => {
      it('records the last thing focused outside a terminal', async () => {
        let editor = await atom.workspace.open();
        atom.views.getView(editor).focus();
        await wait(0);

        expect(Terminal.previousFocus.type).toBe('item');
        expect(Terminal.previousFocus.item).toBe(editor);
      });

      // The whole point of returning `null` from `describeFocus` for
      // terminal-internal targets: xterm moves focus between its container and
      // its helper textarea, and none of that should clobber the way back out.
      it('does not overwrite the record when focus moves into a terminal', async () => {
        let editor = await atom.workspace.open();
        atom.views.getView(editor).focus();
        await wait(0);

        let { inner } = createFakeTerminal();
        inner.focus();
        await wait(0);

        expect(Terminal.previousFocus.item).toBe(editor);
      });
    });

    describe('unfocus()', () => {
      it('restores focus to the previously focused pane item', async () => {
        let editor = await atom.workspace.open();
        let pane = atom.workspace.paneForItem(editor);
        spyOn(pane, 'activateItem').andCallThrough();
        spyOn(pane, 'activate').andCallThrough();
        Terminal.previousFocus = { type: 'item', item: editor };

        Terminal.unfocus();

        expect(pane.activateItem).toHaveBeenCalledWith(editor);
        expect(pane.activate).toHaveBeenCalled();
      });

      it('focuses a recorded element that is still in the document', () => {
        let stray = createStrayElement();
        Terminal.previousFocus = { type: 'element', element: stray };
        spyOn(workspaceElement, 'focus');

        Terminal.unfocus();

        expect(document.activeElement).toBe(stray);
        expect(workspaceElement.focus).not.toHaveBeenCalled();
      });

      it('falls back to the workspace when nothing has been recorded', () => {
        Terminal.previousFocus = null;
        spyOn(workspaceElement, 'focus');

        Terminal.unfocus();

        expect(workspaceElement.focus).toHaveBeenCalled();
      });

      it('falls back to the workspace when the recorded element has been detached', () => {
        let stray = createStrayElement();
        Terminal.previousFocus = { type: 'element', element: stray };
        stray.remove();
        spyOn(workspaceElement, 'focus');

        Terminal.unfocus();

        expect(workspaceElement.focus).toHaveBeenCalled();
      });

      it('falls back to the workspace when the recorded item has been destroyed', async () => {
        let editor = await atom.workspace.open();
        Terminal.previousFocus = { type: 'item', item: editor };
        editor.destroy();
        spyOn(workspaceElement, 'focus');

        Terminal.unfocus();

        expect(workspaceElement.focus).toHaveBeenCalled();
      });

      it('does not also focus the workspace after restoring a pane item', async () => {
        let editor = await atom.workspace.open();
        Terminal.previousFocus = { type: 'item', item: editor };
        spyOn(workspaceElement, 'focus');

        Terminal.unfocus();

        expect(workspaceElement.focus).not.toHaveBeenCalled();
      });
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
      spyOn(Terminal, 'canRunCommands').andReturn(Promise.resolve(true));
    });

    it('runs commands in a new terminal if configured to do so', async () => {
      atom.config.set(`${PACKAGE_NAME}.behavior.runInActive`, false);
      await Terminal.runCommands(commands);
      expect(Terminal.getActiveTerminal).not.toHaveBeenCalled();
      expect(newTerminal.run).toHaveBeenCalledWith('command 1');
      expect(newTerminal.run).toHaveBeenCalledWith('command 2');
    });

    it('runs commands in the active terminal if configured to do so', async () => {
      atom.config.set(`${PACKAGE_NAME}.behavior.runInActive`, true);
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
      expect(atom.workspace.open).toHaveBeenCalledWith(uri, { location: 'center' });
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

  describe('open() with a `split` option', () => {
    let center, terminals;

    beforeEach(async () => {
      jasmine.attachToDOM(atom.views.getView(atom.workspace));
      center = atom.workspace.getCenter();
      terminals = [];
      // Start from a workspace center with a single pane and one item in it.
      await atom.workspace.open();
    });

    afterEach(() => {
      for (let terminal of terminals) {
        terminal.destroy();
      }
    });

    async function openWithSplit (split) {
      let terminal = await Terminal.open(
        Terminal.generateUri(),
        { split, location: 'center' }
      );
      terminals.push(terminal);
      return terminal;
    }

    // These two directions have always worked; they're here to describe the
    // behavior that the other two directions should match.
    it('creates a new pane below when splitting down', async () => {
      let terminal = await openWithSplit('down');
      let panes = center.getPanes();
      expect(panes.length).toBe(2);
      expect(panes[1].getItems()).toContain(terminal);
    });

    it('creates a new pane to the right when splitting right', async () => {
      let terminal = await openWithSplit('right');
      let panes = center.getPanes();
      expect(panes.length).toBe(2);
      expect(panes[1].getItems()).toContain(terminal);
    });

    it('creates a new pane above when splitting up', async () => {
      let originalPane = center.getActivePane();
      let terminal = await openWithSplit('up');
      let panes = center.getPanes();
      expect(panes.length).toBe(2);
      expect(panes[0]).not.toBe(originalPane);
      expect(panes[0].getItems()).toContain(terminal);
      expect(originalPane.getItems()).not.toContain(terminal);
    });

    it('creates a new pane to the left when splitting left', async () => {
      let originalPane = center.getActivePane();
      let terminal = await openWithSplit('left');
      let panes = center.getPanes();
      expect(panes.length).toBe(2);
      expect(panes[0]).not.toBe(originalPane);
      expect(panes[0].getItems()).toContain(terminal);
      expect(originalPane.getItems()).not.toContain(terminal);
    });

    it('reuses an existing pane above instead of creating another', async () => {
      let topmostPane = center.getActivePane();
      topmostPane.splitDown();
      let terminal = await openWithSplit('up');
      expect(center.getPanes().length).toBe(2);
      expect(topmostPane.getItems()).toContain(terminal);
    });

    it('reuses an existing pane to the left instead of creating another', async () => {
      let leftmostPane = center.getActivePane();
      leftmostPane.splitRight();
      let terminal = await openWithSplit('left');
      expect(center.getPanes().length).toBe(2);
      expect(leftmostPane.getItems()).toContain(terminal);
    });

    it('splits within the active dock', async () => {
      let dock = atom.workspace.getBottomDock();
      let terminal = await Terminal.open(
        Terminal.generateUri(),
        { location: 'bottom' }
      );
      terminals.push(terminal);
      expect(dock.getPanes().length).toBe(1);

      let splitTerminal = await Terminal.open(
        Terminal.generateUri(),
        { split: 'up', location: 'bottom' }
      );
      terminals.push(splitTerminal);

      let panes = dock.getPanes();
      expect(panes.length).toBe(2);
      expect(panes[0].getItems()).toContain(splitTerminal);
      expect(center.getPanes().length).toBe(1);
    });

    it('does not leave an empty pane behind if the item never opens', async () => {
      spyOn(atom.workspace, 'open').andReturn(Promise.resolve(undefined));
      await Terminal.open(Terminal.generateUri(), { split: 'up', location: 'center' });
      expect(center.getPanes().length).toBe(1);
    });

    it('does not leave an empty pane behind if opening fails', async () => {
      spyOn(atom.workspace, 'open').andReturn(Promise.reject(new Error('nope')));
      let error;
      try {
        await Terminal.open(Terminal.generateUri(), { split: 'up', location: 'center' });
      } catch (err) {
        error = err;
      }
      expect(error).toBeDefined();
      expect(center.getPanes().length).toBe(1);
    });
  });

  describe('openInCenterOrDock()', () => {
    beforeEach(() => {
      spyOn(atom.workspace, 'open');
      spyOn(Terminal, 'open').andCallThrough();
    });

    it('opens in the bottom dock', async () => {
      await Terminal.openInCenterOrDock(atom.workspace.getBottomDock());
      let options = atom.workspace.open.calls[0].args[1];
      expect(options.location).toBe('bottom');
    });

    it('opens in the left dock', async () => {
      await Terminal.openInCenterOrDock(atom.workspace.getLeftDock());
      let options = atom.workspace.open.calls[0].args[1];
      expect(options.location).toBe('left');
    });

    it('opens in the right dock', async () => {
      await Terminal.openInCenterOrDock(atom.workspace.getRightDock());
      let options = atom.workspace.open.calls[0].args[1];
      expect(options.location).toBe('right');
    });

    it('opens in the center', async () => {
      await Terminal.openInCenterOrDock(atom.workspace.getCenter());
      let options = atom.workspace.open.calls[0].args[1];
      expect(options.location).toBe('center');
    });

    it('leaves the location unset for an unrecognized target', async () => {
      await Terminal.openInCenterOrDock({ getActivePane () {} });
      // `location` is `undefined` when we call `Terminal.open`…
      let options = Terminal.open.calls[0].args[1];
      expect(options.location).toBeUndefined();
      // …but gets filled in with a value by the time we make it to
      // `atom.workspace.open`.
      let workspaceOpenOptions = atom.workspace.open.calls[0].args[1];
      expect(workspaceOpenOptions.location).not.toBeUndefined();
    });

    it('relies on `getActiveWorkspaceLocation()` to provide a fallback location', async () => {
      // To prove where we get the fallback location from, we stub
      // `getActiveWorkspaceLocation` to return `undefined` and test that it
      // gets all the way to `atom.workspace.open` without a `location` value.
      spyOn(Terminal, 'getActiveWorkspaceLocation').andReturn(undefined);
      await Terminal.openInCenterOrDock({ getActivePane () {} });
      let workspaceOpenOptions = atom.workspace.open.calls[0].args[1];
      expect(workspaceOpenOptions.location).toBeUndefined();
    })
  });

});
