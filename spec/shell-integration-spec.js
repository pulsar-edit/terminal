const os = require('os');
const path = require('path');
const fs = require('fs-extra');

const { getShellIntegrationInjection } = require('../lib/shell-integration');
const utils = require('../lib/utils');

const SCRIPT_ROOT = path.resolve(__dirname, '..', 'shell');
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

describe('getShellIntegrationInjection', () => {
  let zdotdir;

  beforeEach(() => {
    atom.config.set('terminal.terminal.enableShellIntegration', true);
    // `injectZsh` derives this deterministically from the real username and
    // real `os.tmpdir()`, so we can predict it and clean it up afterward
    // without needing to mock the filesystem.
    zdotdir = path.join(
      fs.realpathSync(os.tmpdir()),
      `${(() => { try { return os.userInfo().username; } catch { return 'unknown'; } })()}-pulsar-zsh`
    );
  });

  afterEach(async () => {
    if (await fs.pathExists(zdotdir)) {
      await fs.remove(zdotdir);
    }
  });

  it('declines to inject when disabled in settings', async () => {
    atom.config.set('terminal.terminal.enableShellIntegration', false);
    let result = await getShellIntegrationInjection('/bin/bash', [], {});
    expect(result).toEqual({ enabled: false, reason: 'Disabled in settings' });
  });

  it('declines to inject for an unrecognized shell', async () => {
    let result = await getShellIntegrationInjection('/bin/sh', [], {});
    expect(result).toEqual({ enabled: false, reason: 'Unsupported shell: sh' });
  });

  describe('on a platform report of an old Windows build', () => {
    beforeEach(() => {
      spyOn(utils, 'isWindows').andReturn(true);
      spyOn(utils, 'windowsBuildNumber').andReturn(17000);
    });

    it('declines to inject regardless of shell', async () => {
      let result = await getShellIntegrationInjection('/bin/bash', [], {});
      expect(result).toEqual({ enabled: false, reason: 'Windows build too old' });
    });
  });

  describe('bash', () => {
    it('injects --init-file with no args', async () => {
      let result = await getShellIntegrationInjection('/usr/bin/bash', [], {});
      expect(result.enabled).toBe(true);
      expect(result.injection.args).toEqual([
        '--init-file',
        path.join(SCRIPT_ROOT, 'shell-integration-bash.sh')
      ]);
      expect(result.injection.env.PULSAR_TERMINAL_INJECTION).toBe('1');
      expect(result.injection.env.PULSAR_TERMINAL_NONCE).toMatch(UUID_PATTERN);
      expect(result.injection.env.PULSAR_TERMINAL_SHELL_LOGIN).toBeUndefined();
    });

    it('recognizes login args and sets PULSAR_TERMINAL_SHELL_LOGIN', async () => {
      let result = await getShellIntegrationInjection('/usr/bin/bash', ['-l'], {});
      expect(result.enabled).toBe(true);
      expect(result.injection.env.PULSAR_TERMINAL_SHELL_LOGIN).toBe('1');
      // The login flag itself is not forwarded — bash won't read `--init-file`
      // at all if it's also given `-l`, so the script imitates login behavior
      // via the env var instead.
      expect(result.injection.args).not.toContain('-l');
    });

    it('declines to inject when args are not understood', async () => {
      let result = await getShellIntegrationInjection('/usr/bin/bash', ['-c', 'echo hi'], {});
      expect(result).toEqual({ enabled: false, reason: 'Unsupported arguments' });
    });

    it('matches on the basename of the configured shell path', async () => {
      let result = await getShellIntegrationInjection('/opt/homebrew/bin/bash', [], {});
      expect(result.enabled).toBe(true);
      expect(result.injection.args[0]).toBe('--init-file');
    });
  });

  describe('zsh', () => {
    it('injects -i and points ZDOTDIR at a private directory seeded with our dotfiles', async () => {
      let result = await getShellIntegrationInjection('/bin/zsh', [], {});
      expect(result.enabled).toBe(true);
      expect(result.injection.args).toEqual(['-i']);
      expect(result.injection.env.ZDOTDIR).toBe(zdotdir);
      expect(result.injection.env.USER_ZDOTDIR).toBe(os.homedir());

      for (let [source, dest] of [
        ['shell-integration-rc.zsh', '.zshrc'],
        ['shell-integration-profile.zsh', '.zprofile'],
        ['shell-integration-env.zsh', '.zshenv'],
        ['shell-integration-login.zsh', '.zlogin']
      ]) {
        let expected = await fs.readFile(path.join(SCRIPT_ROOT, source), 'utf8');
        let actual = await fs.readFile(path.join(zdotdir, dest), 'utf8');
        expect(actual).toBe(expected);
      }
    });

    it('preserves a preexisting ZDOTDIR as USER_ZDOTDIR', async () => {
      let originalZdotdir = '/some/custom/zdotdir';
      let result = await getShellIntegrationInjection('/bin/zsh', [], { ZDOTDIR: originalZdotdir });
      expect(result.injection.env.USER_ZDOTDIR).toBe(originalZdotdir);
    });

    it('recognizes login args', async () => {
      let result = await getShellIntegrationInjection('/bin/zsh', ['-l'], {});
      expect(result.enabled).toBe(true);
      expect(result.injection.args).toEqual(['-il']);
      expect(result.injection.env.PULSAR_TERMINAL_SHELL_LOGIN).toBe('1');
    });

    it('declines to inject when args are not understood', async () => {
      let result = await getShellIntegrationInjection('/bin/zsh', ['-c', 'echo hi'], {});
      expect(result).toEqual({ enabled: false, reason: 'Unsupported arguments' });
    });
  });

  describe('fish', () => {
    it('injects --init-command with no args', async () => {
      let result = await getShellIntegrationInjection('/usr/bin/fish', [], {});
      expect(result.enabled).toBe(true);
      expect(result.injection.args).toEqual([
        '--init-command',
        `source "${path.join(SCRIPT_ROOT, 'shell-integration.fish')}"`
      ]);
    });

    it('adds -l and reports login for login args', async () => {
      let result = await getShellIntegrationInjection('/usr/bin/fish', ['-l'], {});
      expect(result.enabled).toBe(true);
      expect(result.injection.args[0]).toBe('-l');
    });
  });

  describe('pwsh', () => {
    it('injects a dot-sourcing -command on non-Windows', async () => {
      let result = await getShellIntegrationInjection('/usr/local/bin/pwsh', [], {});
      expect(result.enabled).toBe(true);
      expect(result.injection.args).toEqual([
        '-noexit',
        '-command',
        `. "${path.join(SCRIPT_ROOT, 'shell-integration.ps1')}"`
      ]);
    });

    it('wraps the sourcing command in try/catch on Windows', async () => {
      spyOn(utils, 'isWindows').andReturn(true);
      spyOn(utils, 'windowsBuildNumber').andReturn(22631);
      let result = await getShellIntegrationInjection('pwsh.exe', [], {});
      expect(result.enabled).toBe(true);
      let scriptPath = path.join(SCRIPT_ROOT, 'shell-integration.ps1');
      expect(result.injection.args[2]).toBe(`try { . "${scriptPath}" } catch {}`);
    });

    it('declines to inject when args are neither implied nor login', async () => {
      let result = await getShellIntegrationInjection('/usr/local/bin/pwsh', ['-File', 'script.ps1'], {});
      expect(result).toEqual({ enabled: false, reason: 'Unsupported arguments' });
    });
  });
});
