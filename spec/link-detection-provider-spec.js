const os = require('os');
const path = require('path');
const fs = require('fs-extra');

const { Terminal } = require('@xterm/xterm');
const { LocalPathLinkProvider } = require('../lib/link-detection/provider');

// xterm.js defers flushing its write buffer via a real timer, so this only
// resolves once Jasmine's clock is real (see `jasmine.useRealClock()` below)
// — with the mocked clock, this simply never fires and the spec times out.
async function write (terminal, data) {
  return new Promise((resolve) => terminal.write(data, resolve));
}

function provideLinks (provider, bufferLineNumber) {
  return new Promise((resolve) => provider.provideLinks(bufferLineNumber, resolve));
}

describe('LocalPathLinkProvider', () => {
  let terminal, fixtureDir, filePath, dirPath, spacedFilePath;

  beforeEach(async () => {
    jasmine.useRealClock();
    terminal = new Terminal({ allowProposedApi: true, cols: 200 });

    fixtureDir = await fs.mkdtemp(path.join(fs.realpathSync(os.tmpdir()), 'terminal-link-detection-'));
    filePath = path.join(fixtureDir, 'notes.txt');
    dirPath = path.join(fixtureDir, 'subdir');
    spacedFilePath = path.join(fixtureDir, 'a file with spaces.txt');
    await fs.writeFile(filePath, 'hello');
    await fs.mkdir(dirPath);
    await fs.writeFile(spacedFilePath, 'hello');
  });

  afterEach(async () => {
    terminal.dispose();
    await fs.remove(fixtureDir);
  });

  it('resolves an absolute path to an existing file', async () => {
    let provider = new LocalPathLinkProvider(terminal, () => undefined, () => {});
    await write(terminal, filePath);
    let links = await provideLinks(provider, 1);
    expect(links.length).toBe(1);
    expect(links[0].text).toBe(filePath);
  });

  it('resolves an absolute path to an existing directory', async () => {
    let activate = jasmine.createSpy('activate');
    let provider = new LocalPathLinkProvider(terminal, () => undefined, activate);
    await write(terminal, dirPath);
    let links = await provideLinks(provider, 1);
    expect(links.length).toBe(1);
    links[0].activate({}, links[0].text);
    expect(activate).toHaveBeenCalledWith({}, dirPath, true, undefined, undefined);
  });

  it('does not resolve a path that does not exist', async () => {
    let provider = new LocalPathLinkProvider(terminal, () => undefined, () => {});
    await write(terminal, path.join(fixtureDir, 'nope.txt'));
    let links = await provideLinks(provider, 1);
    expect(links).toBeUndefined();
  });

  it('resolves a relative path against the provided cwd', async () => {
    // A bare filename with no `/` in it (e.g. `notes.txt`) isn't detected as
    // a path candidate at all by the underlying regex — there'd be no way
    // to distinguish it from an ordinary word. A `./`-prefixed or
    // `/`-containing relative path is what gets detected.
    let provider = new LocalPathLinkProvider(terminal, () => fixtureDir, () => {});
    await write(terminal, 'edit ./notes.txt now');
    let links = await provideLinks(provider, 1);
    expect(links.length).toBe(1);
    expect(links[0].text).toBe('./notes.txt');
  });

  it('does not resolve a relative path when no cwd is known and the file is not in the process cwd', async () => {
    let provider = new LocalPathLinkProvider(terminal, () => undefined, () => {});
    await write(terminal, 'edit ./notes.txt now');
    let links = await provideLinks(provider, 1);
    expect(links).toBeUndefined();
  });

  it('strips a :line:col suffix and still resolves the underlying file', async () => {
    let provider = new LocalPathLinkProvider(terminal, () => undefined, () => {});
    await write(terminal, `Error at ${filePath}:1:1 during build`);
    let links = await provideLinks(provider, 1);
    expect(links.length).toBe(1);
    expect(links[0].text).toBe(`${filePath}:1:1`);
  });

  it('passes the parsed line and column through to activate', async () => {
    let activate = jasmine.createSpy('activate');
    let provider = new LocalPathLinkProvider(terminal, () => undefined, activate);
    await write(terminal, `Error at ${filePath}:12:34 during build`);
    let links = await provideLinks(provider, 1);
    let event = {};
    links[0].activate(event, links[0].text);
    expect(activate).toHaveBeenCalledWith(event, filePath, false, 12, 34);
  });

  it('activates a resolved file link with the absolute path and isDirectory: false', async () => {
    let activate = jasmine.createSpy('activate');
    let provider = new LocalPathLinkProvider(terminal, () => undefined, activate);
    await write(terminal, filePath);
    let links = await provideLinks(provider, 1);
    let event = {};
    links[0].activate(event, links[0].text);
    expect(activate).toHaveBeenCalledWith(event, filePath, false, undefined, undefined);
  });

  it('falls back to the space-tolerant matchers for a spaced path with no other candidates', async () => {
    let provider = new LocalPathLinkProvider(terminal, () => undefined, () => {});
    await write(terminal, spacedFilePath);
    let links = await provideLinks(provider, 1);
    expect(links.length).toBe(1);
    expect(links[0].text).toBe(spacedFilePath);
  });

  it('returns undefined for a line with no path-like content', async () => {
    let provider = new LocalPathLinkProvider(terminal, () => undefined, () => {});
    await write(terminal, 'just some plain output');
    let links = await provideLinks(provider, 1);
    expect(links).toBeUndefined();
  });
});
