
const { TerminalModel } = require('../lib/model');

// const fs = require('fs-extra');
// const path = require('path');
const temp = require('temp');

temp.track();

describe('TerminalModel', () => {
  let model, pane, element, tmpdir, uri, terminals;

  beforeEach(async () => {
    uri = 'terminal://some-session-id';
    terminals = new Set();
    model = new TerminalModel({ uri, terminals });
    await model.ready();
    pane = jasmine.createSpyObj('pane', ['destroyItem', 'getActiveItem', 'activateItem']);
    element = jasmine.createSpyObj(
      'element',
      [
        'destroy',
        'refitTerminal',
        'focusTerminal',
        'clickOnCurrentAnchor',
        'getCurrentAnchorHref',
        'restartPtyProcess'
      ]
    );
    element.terminal = jasmine.createSpyObj('terminal', ['getSelection']);
    element.pty = jasmine.createSpyObj('pty', ['write']);
    tmpdir = await temp.mkdir();
  });

  afterEach(async () => await temp.cleanup());

  it('handles a previous active item that has no getPath() method', async () => {
    atom.config.set('terminal.terminal.useProjectRootAsCwd', true);
    atom.project.setPaths([tmpdir]);
    spyOn(atom.workspace, 'getActivePaneItem').andReturn({});
    let newModel = new TerminalModel({ uri, terminals });
    await newModel.ready();
    expect(newModel.getPath()).toBe(tmpdir);
  });

  xit('handles a previous active item that does have a getPath() method', async () => {
    atom.config.set('terminal.terminal.useProjectRootAsCwd', true);
    let previousActiveItem = jasmine.createSpyObj('somemodel', ['getPath']);
    console.log('prev active item returns:', tmpdir);
    previousActiveItem.getPath.andReturn(tmpdir);
    spyOn(atom.workspace, 'getActivePaneItem').andReturn(previousActiveItem);
    let newModel = new TerminalModel({ uri, terminals });
    await newModel.ready();
    expect(newModel.getPath()).toBe(tmpdir);
  });

  // TODO: More `getPath` specs that I cannot quite follow right now.

  it('handles being constructed with a target cwd', async () => {
    let expected = __dirname;
    let url = new URL(uri);
    url.searchParams.set('cwd', __filename);
    let newModel = new TerminalModel({ uri: url.href, terminals });
    await newModel.ready();
    expect(newModel.getPath()).toBe(expected);
  });

  it('serializes', () => {
    expect(model.serialize()).toEqual({
      deserializer: 'TerminalModel',
      version: '1.0.0',
      uri
    });
  });

  it('destroys the element when destroy() is called', () => {
    model.element = element;
    model.destroy();
    expect(model.element.destroy).toHaveBeenCalled();
  });

  it('removes the terminal from the master set when destroy is called', () => {
    expect(terminals.has(model)).toBe(true);
    model.destroy();
    expect(terminals.has(model)).toBe(false);
  });

  it('uses the standard title by default', () => {
    expect(model.getTitle()).toBe('Terminal');
  });

  it('adds the active indicator to the title when active', () => {
    atom.config.set('terminal.terminal.activeTerminalIndicator', '⦿ ');
    spyOn(model, 'isActive').andReturn(true);
    expect(model.getTitle()).toBe('⦿ Terminal');
  });

  it('returns the element via getElement()', () => {
    let expected = { something: 'something' };
    model.element = expected;
    expect(model.getElement()).toBe(expected);
  });

  it('returns the correct long title when the title is the default', () => {
    expect(model.getLongTitle()).toBe('Terminal');
  });

  it ('returns the correct long title when the title has been customized', () => {
    model.title = 'some new title';
    expect(model.getLongTitle()).toBe('Terminal (some new title)');
  });

  it('broadcasts title changes via onDidChangeTitle()', () => {
    let spy = jasmine.createSpy('titleSpy');
    let disposable = model.onDidChangeTitle(spy);
    let expected = 'new title';
    model.emitter.emit('did-change-title', expected);
    expect(spy).toHaveBeenCalledWith(expected);
    disposable.dispose();
  });

  // TODO: `atom-community/terminal` uses the “modified” indicator to
  // communicate whether there is unread output in the terminal. Consider doing
  // the same.

  it('shows the correct icon with getIconName()', () => {
    expect(model.getIconName()).toBe('terminal');
  });

  it('represents cwd correctly via getPath()', () => {
    let expected = '/some/dir';
    model.cwd = expected;
    expect(model.getPath()).toBe(expected);
  });

  describe('handleNewDataArrival()', () => {
    it('functions as expected when the model initially has no pane set', () => {
      pane.getActiveItem.andReturn({});
      spyOn(atom.workspace, 'paneForItem').andReturn(pane);
      model.handleNewData();
      expect(atom.workspace.paneForItem).toHaveBeenCalled();
    });

    // TODO: Lots of specs relating to the modified status of the pane item.
  });

  it('returns a unique ID for the terminal via getSessionId()', () => {
    expect(model.getSessionId()).toBe('some-session-id');
  });

  it('should be able to refit the terminal even when an element has not been set', () => {
    model.refitTerminal();
  });

  it('should be able to refit the terminal with an element set', () => {
    model.element = element;
    model.refitTerminal();
    expect(model.element.refitTerminal).toHaveBeenCalled();
  });

  describe('focusTerminal()', () => {
    it('calls through to the element', () => {
      model.element = element;
      model.focusTerminal();
      expect(model.element.focusTerminal).toHaveBeenCalled();
    });

    // TODO: Relation to the “modified” flag.

    it('activates the pane item', () => {
      model.element = element;
      model.pane = pane;
      model.focusTerminal();
      expect(model.pane.activateItem).toHaveBeenCalledWith(model);
    });

    it('passes along the "double" parameter', () => {
      model.element = element;
      model.focusTerminal(true);
      expect(model.element.focusTerminal).toHaveBeenCalledWith(true);
    });
  });

  it('destroys the model when exit() is called', () => {
    model.pane = pane;
    model.exit();
    expect(model.pane.destroyItem.calls[0].args).toEqual([model, true]);
  });

  describe('restartPtyProcess()', () => {
    it('is a no-op with no element set', () => {
      model.restartPtyProcess();
      expect(element.restartPtyProcess).not.toHaveBeenCalled();
    });

    it('works with an element set', () => {
      model.element = element;
      model.restartPtyProcess();
      expect(element.restartPtyProcess).toHaveBeenCalled();
    });
  });

  it('copies text from the terminal when copyFromTerminal() is called', () => {
    model.element = element;
    model.copyFromTerminal();
    expect(model.element.terminal.getSelection).toHaveBeenCalled();
  });

  it('runs a command via run()', () => {
    model.element = element;
    let expectedText = 'some text';
    model.run(expectedText);
    let args = model.element.pty.write.calls[0].args;
    expect(args).toEqual(
      [expectedText + (process.platform === 'win32' ? '\r' : '\n')]
    );
  });

  it('pastes text via paste()', () => {
    model.element = element;
    let expectedText = 'some text';
    model.paste(expectedText);
    let args = model.element.pty.write.calls[0].args;
    expect(args).toEqual([expectedText]);
  });

  it('manages the active terminal correctly via setActive()', async () => {
    let activePane = atom.workspace.getCenter().getActivePane();
    let newTerminals = new Set();
    let model1 = new TerminalModel({ uri, terminals: newTerminals });
    await model1.ready();
    activePane.addItem(model1);
    model1.moveToPane(activePane);

    let model2 = new TerminalModel({ uri, terminals: newTerminals });
    await model2.ready();
    activePane.addItem(model2);
    model2.moveToPane(activePane);

    expect(model1.activeIndex).toBe(0);
    expect(model2.activeIndex).toBe(1);

    model2.setActive();
    expect(model1.activeIndex).toBe(1);
    expect(model2.activeIndex).toBe(0);
  });

  describe('moveToPane', () => {
    it('(mock)', async () => {
      const expected = { getContainer: () => ({ getLocation: () => {} }) };
      model.moveToPane(expected);
      expect(model.pane).toBe(expected);
      expect(model.dock).toBe(undefined);
    });

    it("(center)", async () => {
      const activePane = atom.workspace.getCenter().getActivePane();
      model.moveToPane(activePane);
      expect(model.pane).toBe(activePane);
      expect(model.dock).toBe(undefined);
    })

    it("(left)", async () => {
      const dock = atom.workspace.getLeftDock();
      const activePane = dock.getActivePane();
      model.moveToPane(activePane);
      expect(model.pane).toBe(activePane);
      expect(model.dock).toBe(dock);
    })

    it("(right)", async () => {
      const dock = atom.workspace.getRightDock();
      const activePane = dock.getActivePane();
      model.moveToPane(activePane);
      expect(model.pane).toBe(activePane);
      expect(model.dock).toBe(dock);
    })

    it("(bottom)", async () => {
      const dock = atom.workspace.getBottomDock();
      const activePane = dock.getActivePane();
      model.moveToPane(activePane);
      expect(model.pane).toBe(activePane);
      expect(model.dock).toBe(dock);
    })
  });

  describe('isVisible()', () => {
    it('works within a pane', () => {
      let activePane = atom.workspace.getCenter().getActivePane();
      model.moveToPane(activePane);
      expect(model.isVisible()).toBe(false);
      activePane.setActiveItem(model);
      expect(model.isVisible()).toBe(true);
    });

    it('works within a dock', () => {
      let dock = atom.workspace.getBottomDock();
      let activePane = dock.getActivePane();
      model.moveToPane(activePane);
      activePane.setActiveItem(model);
      expect(model.isVisible()).toBe(false);
      dock.show();
      expect(model.isVisible()).toBe(true);
    });
  });

  describe('isActive()', () => {
    beforeEach(() => {
      atom.config.set('terminal.behavior.activeTerminalLogic', 'visible');
    });

    it('works when the terminal is visible and active', () => {
      model.activeIndex = 0;
      spyOn(model, 'isVisible').andReturn(true);
      expect(model.isActive()).toBe(true);
    });

    it('works when the terminal is visible and not active', () => {
      model.activeIndex = 1;
      spyOn(model, 'isVisible').andReturn(true);
      expect(model.isActive()).toBe(false);
    });

    it('works when the terminal is invisible and active', () => {
      model.activeIndex = 0;
      spyOn(model, 'isVisible').andReturn(false);
      expect(model.isActive()).toBe(false);
    });

    it('works when the terminal is invisible and active (and we have opted into it via config)', () => {
      atom.config.set('terminal.behavior.activeTerminalLogic', 'all');
      model.activeIndex = 0;
      spyOn(model, 'isVisible').andReturn(false);
      expect(model.isActive()).toBe(true);
    });
  });

  describe('TerminalModel.is', () => {
    it('works when the item is a terminal model', () => {
      expect(TerminalModel.is(model)).toBe(true);
    });

    it('works when the item is not a terminal model', () => {
      let item = document.createElement('div');
      expect(TerminalModel.is(item)).toBe(false);
    });
  });

  describe('TerminalModel.recalculateActive()', () => {
    const createTerminals = (num = 1) => {
      const terminals = [];
      for (let i = 0; i < num; i++) {
        terminals.push({
          activeIndex: i,
          isVisible() {},
          emitter: {
            emit() {},
          },
          setIndex: function(newIndex) {
            this.activeIndex = newIndex;
            this.emitter.emit('did-change-title', this.title);
          },
          title: `title ${i}`,
        });
      }
      return terminals;
    }

    it("active first", () => {
      const terminals = createTerminals(2);
      TerminalModel.recalculateActive(new Set(terminals), terminals[1]);
      expect(terminals[0].activeIndex).toBe(1);
      expect(terminals[1].activeIndex).toBe(0);
    });

    it("visible before hidden", () => {
      const terminals = createTerminals(2);
      spyOn(terminals[1], "isVisible").andReturn(true);
      TerminalModel.recalculateActive(new Set(terminals));
      expect(terminals[0].activeIndex).toBe(1);
      expect(terminals[1].activeIndex).toBe(0);
    });

    it("activeTerminalLogic = 'all'", () => {
      atom.config.set('terminal.behavior.activeTerminalLogic', 'all');
      const terminals = createTerminals(2);
      spyOn(terminals[0], "isVisible").andReturn(false);
      spyOn(terminals[1], "isVisible").andReturn(true);
      TerminalModel.recalculateActive(new Set(terminals));
      expect(terminals[0].activeIndex).toBe(0);
      expect(terminals[1].activeIndex).toBe(1);
    });

    it("lower active index first", () => {
      const terminals = createTerminals(2);
      terminals[0].setIndex(1);
      terminals[1].setIndex(0);
      TerminalModel.recalculateActive(new Set(terminals));
      expect(terminals[0].activeIndex).toBe(1);
      expect(terminals[1].activeIndex).toBe(0);
    });

    it("emits did-change-title", () => {
      const terminals = createTerminals(2);
      spyOn(terminals[0].emitter, "emit");
      spyOn(terminals[1].emitter, "emit");
      TerminalModel.recalculateActive(new Set(terminals));
      expect(terminals[0].emitter.emit).toHaveBeenCalledWith("did-change-title", "title 0");
      expect(terminals[1].emitter.emit).toHaveBeenCalledWith("did-change-title", "title 1");
    });
  });

});
