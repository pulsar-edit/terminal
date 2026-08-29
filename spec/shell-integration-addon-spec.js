const { Terminal } = require('@xterm/xterm');
const { ShellIntegrationAddon } = require('../lib/shell-integration/addon');

// xterm.js defers flushing its write buffer via a real timer, so this only
// resolves once Jasmine's clock is real (see `jasmine.useRealClock()` below)
// — with the mocked clock, this simply never fires and the spec times out.
async function write (terminal, data) {
  return new Promise((resolve) => terminal.write(data, resolve));
}

describe('ShellIntegrationAddon', () => {
  let terminal, addon;

  beforeEach(() => {
    jasmine.useRealClock();
    terminal = new Terminal({ allowProposedApi: true });
    addon = new ShellIntegrationAddon();
    terminal.loadAddon(addon);
  });

  afterEach(() => {
    terminal.dispose();
  });

  describe('Cwd', () => {
    it('reports a plain cwd', async () => {
      let spy = jasmine.createSpy('cwd-spy');
      addon.onDidChangeCwd(spy);
      await write(terminal, '\x1b]633;P;Cwd=/Users/andrew/code\x07');
      expect(spy).toHaveBeenCalledWith('/Users/andrew/code');
    });

    it('unescapes semicolons, backslashes, and control characters', async () => {
      let spy = jasmine.createSpy('cwd-spy');
      addon.onDidChangeCwd(spy);
      // A path like `/tmp/a;b\c` would be escaped by `__pulsar_escape_value`
      // as `/tmp/a\x3bb\\c`.
      await write(terminal, '\x1b]633;P;Cwd=/tmp/a\\x3bb\\\\c\x07');
      expect(spy).toHaveBeenCalledWith('/tmp/a;b\\c');
    });

    it('ignores properties other than Cwd', async () => {
      let spy = jasmine.createSpy('cwd-spy');
      addon.onDidChangeCwd(spy);
      await write(terminal, '\x1b]633;P;IsWindows=True\x07');
      expect(spy).not.toHaveBeenCalled();
    });

    it('does not throw on a malformed property sequence', async () => {
      await write(terminal, '\x1b]633;P;NotAKeyValuePair\x07');
      // No assertion beyond "didn't throw" — reaching this line is the point.
    });
  });

  describe('command detection', () => {
    const NONCE = 'test-nonce';

    beforeEach(() => {
      addon.setNonce(NONCE);
    });

    it('reports a command as it executes, with its command line and last-known cwd', async () => {
      let spy = jasmine.createSpy('execute-spy');
      addon.onDidExecuteCommand(spy);

      await write(terminal, '\x1b]633;P;Cwd=/Users/andrew/code\x07');
      await write(terminal, `\x1b]633;E;npm run build;${NONCE}\x07`);
      await write(terminal, '\x1b]633;C\x07');

      expect(spy).toHaveBeenCalledWith({
        commandLine: 'npm run build',
        cwd: '/Users/andrew/code',
        exitCode: undefined
      });
    });

    it('does not attribute a command line when the nonce is missing', async () => {
      let spy = jasmine.createSpy('execute-spy');
      addon.onDidExecuteCommand(spy);

      await write(terminal, '\x1b]633;E;npm run build\x07');
      await write(terminal, '\x1b]633;C\x07');

      expect(spy.calls[0].args[0].commandLine).toBeUndefined();
    });

    it('does not attribute a command line when the nonce does not match', async () => {
      let spy = jasmine.createSpy('execute-spy');
      addon.onDidExecuteCommand(spy);

      await write(terminal, '\x1b]633;E;npm run build;some-other-nonce\x07');
      await write(terminal, '\x1b]633;C\x07');

      expect(spy.calls[0].args[0].commandLine).toBeUndefined();
    });

    it('does not attribute a command line before a nonce has been configured', async () => {
      let freshAddon = new ShellIntegrationAddon();
      terminal.loadAddon(freshAddon);
      let spy = jasmine.createSpy('execute-spy');
      freshAddon.onDidExecuteCommand(spy);

      await write(terminal, `\x1b]633;E;npm run build;${NONCE}\x07`);
      await write(terminal, '\x1b]633;C\x07');

      expect(spy.calls[0].args[0].commandLine).toBeUndefined();
    });

    it('reports a finished command with its exit code', async () => {
      let spy = jasmine.createSpy('finish-spy');
      addon.onDidFinishCommand(spy);

      await write(terminal, `\x1b]633;E;npm run build;${NONCE}\x07`);
      await write(terminal, '\x1b]633;C\x07');
      await write(terminal, '\x1b]633;D;1\x07');

      let reported = spy.calls[0].args[0];
      expect(reported.commandLine).toBe('npm run build');
      expect(reported.exitCode).toBe(1);
    });

    it('reports exitCode undefined when D carries no exit code', async () => {
      let spy = jasmine.createSpy('finish-spy');
      addon.onDidFinishCommand(spy);

      await write(terminal, `\x1b]633;E;true;${NONCE}\x07`);
      await write(terminal, '\x1b]633;C\x07');
      await write(terminal, '\x1b]633;D\x07');

      expect(spy.calls[0].args[0].exitCode).toBeUndefined();
    });

    it('does not fire onDidFinishCommand for a D with no matching C', async () => {
      let spy = jasmine.createSpy('finish-spy');
      addon.onDidFinishCommand(spy);

      // The empty-Enter-press case: the shell's precmd hook still runs and
      // still emits D, but preexec (and so E/C) never fired.
      await write(terminal, '\x1b]633;D\x07');

      expect(spy).not.toHaveBeenCalled();
    });

    it('starts a fresh command for each execution', async () => {
      let executed = [];
      let finished = [];
      addon.onDidExecuteCommand((command) => executed.push(command));
      addon.onDidFinishCommand((command) => finished.push(command));

      await write(terminal, `\x1b]633;E;first;${NONCE}\x07`);
      await write(terminal, '\x1b]633;C\x07');
      await write(terminal, '\x1b]633;D;0\x07');

      await write(terminal, `\x1b]633;E;second;${NONCE}\x07`);
      await write(terminal, '\x1b]633;C\x07');
      await write(terminal, '\x1b]633;D;127\x07');

      expect(executed.map(c => c.commandLine)).toEqual(['first', 'second']);
      expect(finished.map(c => [c.commandLine, c.exitCode])).toEqual([
        ['first', 0],
        ['second', 127]
      ]);
    });
  });

  describe('unrecognized/unimplemented sequences', () => {
    it('does not throw for lifecycle letters not yet acted upon', async () => {
      for (let sequence of ['A', 'B', 'F', 'G', 'H', 'I']) {
        await write(terminal, `\x1b]633;${sequence}\x07`);
      }
    });

    it('does not throw for environment-reporting sequences', async () => {
      await write(terminal, '\x1b]633;EnvSingleStart;0;some-nonce\x07');
      await write(terminal, '\x1b]633;EnvSingleEntry;PATH;/usr/bin;some-nonce\x07');
      await write(terminal, '\x1b]633;EnvSingleEnd;some-nonce\x07');
      await write(terminal, '\x1b]633;EnvJson;{};some-nonce\x07');
    });
  });

  describe('dispose()', () => {
    it('stops handling sequences after disposal', async () => {
      let spy = jasmine.createSpy('cwd-spy');
      addon.onDidChangeCwd(spy);
      addon.dispose();
      // The OSC handler is gone, so this sequence now falls through
      // unhandled rather than reaching our callback.
      await write(terminal, '\x1b]633;P;Cwd=/should/not/be/seen\x07');
      expect(spy).not.toHaveBeenCalled();
    });
  });
});
