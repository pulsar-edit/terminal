// The logic in this file is adapted from VS Code's `getShellIntegrationInjection`
// (`src/vs/platform/terminal/node/terminalEnvironment.ts`), which is
// Copyright (c) Microsoft Corporation and licensed under the MIT License.
//
// Deliberately trimmed relative to the original:
//
// - No `EnvironmentVariableCollection` support. That's the extension API VS
//   Code uses to let other extensions (e.g. a Python extension activating a
//   venv) prepend/append/replace PATH and other vars before the shell starts.
//   Pulsar's `terminal` package has no equivalent mechanism yet, so the
//   macOS/fish PATH-prefix fixup that depends on it (see VS Code's
//   `addEnvMixinPathPrefix`) is left out. Revisit if/when this package grows
//   something like that API.
// - No Windows-registry build-number lookup. `os.release()` (already wrapped
//   by `windowsBuildNumber()` in `utils.ts`) is good enough for the coarse
//   "is shell integration supported at all" check we need here.
// - No localization/formatting helper (`format(str, ...args)`); arguments are
//   built with plain template literals instead.

import * as os from 'os';
import * as path from 'path';
import fs from 'fs-extra';

import { Config } from '../config';
import { isWindows, windowsBuildNumber } from '../utils';
import * as Logger from '../log';

// Compiled to `lib/shell-integration/index.js` (Rollup's `preserveModules`
// mirrors `src/`), so the package root — and the `shell/` directory next to
// it — is two levels up from here.
const PACKAGE_ROOT = path.normalize(path.join(__dirname, '..', '..'));
const SCRIPT_ROOT = path.join(PACKAGE_ROOT, 'shell');

// Windows builds older than this predate the ConPTY improvements that shell
// integration depends on to work reliably.
const MINIMUM_WINDOWS_BUILD_FOR_SHELL_INTEGRATION = 18309;

type SingleOrMany<T> = T | T[];

function isString (value: unknown): value is string {
  return typeof value === 'string';
}

export type ShellIntegrationInjection = {
  args: string[];
  env: Record<string, string>;
};

export type ShellIntegrationResult =
  | { enabled: true; injection: ShellIntegrationInjection }
  | { enabled: false; reason: string };

// These argument-detection helpers mirror VS Code's approach: if the user has
// already configured shell args we don't recognize, we decline to inject
// rather than risk clobbering something intentional (a custom `--rcfile`, for
// instance).
const POWERSHELL_LOGIN_ARGS = ['-login', '-l'];
const SH_LOGIN_ARGS = ['--login', '-l'];
const SH_INTERACTIVE_ARGS = ['-i', '--interactive'];
const POWERSHELL_IMPLIED_ARGS = ['-nol', '-nologo'];

function arePowerShellLoginArgs (args: SingleOrMany<string>): boolean {
  if (isString(args)) return POWERSHELL_LOGIN_ARGS.includes(args.toLowerCase());
  if (args.length === 1) return POWERSHELL_LOGIN_ARGS.includes(args[0].toLowerCase());
  if (args.length === 2) {
    return POWERSHELL_LOGIN_ARGS.every((arg, i) => arg === args[i].toLowerCase());
  }
  return false;
}

function arePowerShellImpliedArgs (args: SingleOrMany<string>): boolean {
  if (isString(args)) return POWERSHELL_IMPLIED_ARGS.includes(args.toLowerCase());
  if (args.length === 0) return true;
  if (args.length === 1) return POWERSHELL_IMPLIED_ARGS.includes(args[0].toLowerCase());
  return false;
}

// Bash/zsh/fish all treat login-shell args the same way for our purposes.
function isShLoginArgs (args: SingleOrMany<string>): boolean {
  let list = isString(args) ?
    [args] :
    args.filter(arg => !SH_INTERACTIVE_ARGS.includes(arg.toLowerCase()));
  return list.length === 1 && SH_LOGIN_ARGS.includes(list[0].toLowerCase());
}

function safeUsername (): string {
  try {
    return os.userInfo().username;
  } catch {
    return 'unknown';
  }
}

function realTempDir (): string {
  try {
    return fs.realpathSync(os.tmpdir());
  } catch {
    return os.tmpdir();
  }
}

/**
 * Given the shell command and args the user has configured, decides whether
 * shell integration can be injected, and if so, returns the additional args
 * and environment variables needed to do it. Callers should merge these into
 * the args/env they'd otherwise pass to `Pty`.
 *
 * `env` is the environment the shell is about to be spawned with — used only
 * to read a preexisting `ZDOTDIR`, if any, before we override it for zsh.
 */
export async function getShellIntegrationInjection (
  shellCommand: string,
  shellArgs: string[],
  env: Record<string, string>
): Promise<ShellIntegrationResult> {
  if (!Config.get('terminal.enableShellIntegration')) {
    return { enabled: false, reason: 'Disabled in settings' };
  }
  if (isWindows() && (windowsBuildNumber() ?? 0) < MINIMUM_WINDOWS_BUILD_FOR_SHELL_INTEGRATION) {
    return { enabled: false, reason: 'Windows build too old' };
  }

  let shell = path.basename(shellCommand).toLowerCase();

  let envMixin: Record<string, string> = {
    PULSAR_TERMINAL_INJECTION: '1',
    PULSAR_TERMINAL_NONCE: crypto.randomUUID()
  };

  switch (shell) {
    case 'bash':
    case 'bash.exe':
      return injectBash(shellArgs, envMixin);
    case 'zsh':
      return injectZsh(shellArgs, envMixin, env);
    case 'fish':
      return injectFish(shellArgs, envMixin);
    case 'pwsh':
    case 'pwsh.exe':
    case 'powershell.exe':
      return injectPowerShell(shellArgs, envMixin);
    default:
      Logger.debug(`Shell integration: unsupported shell "${shell}"`);
      return { enabled: false, reason: `Unsupported shell: ${shell}` };
  }
}

function injectBash (
  originalArgs: string[],
  envMixin: Record<string, string>
): ShellIntegrationResult {
  let isLogin = isShLoginArgs(originalArgs);
  if (originalArgs.length > 0 && !isLogin) {
    return { enabled: false, reason: 'Unsupported arguments' };
  }
  if (isLogin) {
    envMixin.PULSAR_TERMINAL_SHELL_LOGIN = '1';
  }
  let args = ['--init-file', path.join(SCRIPT_ROOT, 'shell-integration-bash.sh')];
  return { enabled: true, injection: { args, env: envMixin } };
}

function injectFish (
  originalArgs: string[],
  envMixin: Record<string, string>
): ShellIntegrationResult {
  let isLogin = isShLoginArgs(originalArgs);
  if (originalArgs.length > 0 && !isLogin) {
    return { enabled: false, reason: 'Unsupported arguments' };
  }
  let args = [
    ...(isLogin ? ['-l'] : []),
    '--init-command',
    `source "${path.join(SCRIPT_ROOT, 'shell-integration.fish')}"`
  ];
  return { enabled: true, injection: { args, env: envMixin } };
}

function injectPowerShell (
  originalArgs: string[],
  envMixin: Record<string, string>
): ShellIntegrationResult {
  let isLogin = arePowerShellLoginArgs(originalArgs);
  if (!isLogin && !arePowerShellImpliedArgs(originalArgs)) {
    return { enabled: false, reason: 'Unsupported arguments' };
  }
  let scriptPath = path.join(SCRIPT_ROOT, 'shell-integration.ps1');
  // On Windows, an execution-policy restriction can make dot-sourcing throw;
  // swallow that rather than blocking startup. Not a concern on Unix pwsh.
  let sourceCommand = isWindows() ?
    `try { . "${scriptPath}" } catch {}` :
    `. "${scriptPath}"`;
  let args = [
    ...(isLogin ? ['-l'] : []),
    '-noexit',
    '-command',
    sourceCommand
  ];
  return { enabled: true, injection: { args, env: envMixin } };
}

async function injectZsh (
  originalArgs: string[],
  envMixin: Record<string, string>,
  env: Record<string, string>
): Promise<ShellIntegrationResult> {
  let isLogin = isShLoginArgs(originalArgs);
  if (originalArgs.length > 0 && !isLogin) {
    return { enabled: false, reason: 'Unsupported arguments' };
  }
  let args = [isLogin ? '-il' : '-i'];
  if (isLogin) {
    envMixin.PULSAR_TERMINAL_SHELL_LOGIN = '1';
  }

  // Zsh has no `--init-file` equivalent, so instead we point `ZDOTDIR` at a
  // private directory seeded with our own dotfiles. Each of those
  // (shell-integration-{env,rc,profile,login}.zsh) immediately swaps
  // `ZDOTDIR` back to `USER_ZDOTDIR` and sources the user's real dotfile of
  // the same name, so the user's own setup still runs.
  let zdotdir = path.join(realTempDir(), `${safeUsername()}-pulsar-zsh`);

  try {
    await fs.ensureDir(zdotdir);
    // Sticky bit: on a shared machine, only the owner may delete/rename
    // files here, so another user can't swap in a hostile dotfile.
    await fs.chmod(zdotdir, 0o1700);
  } catch (err) {
    Logger.error(`Shell integration: failed to prepare ZDOTDIR at ${zdotdir}: ${err}`);
    return { enabled: false, reason: 'Failed to create ZDOTDIR' };
  }

  await Promise.all([
    fs.copy(path.join(SCRIPT_ROOT, 'shell-integration-rc.zsh'), path.join(zdotdir, '.zshrc')),
    fs.copy(path.join(SCRIPT_ROOT, 'shell-integration-profile.zsh'), path.join(zdotdir, '.zprofile')),
    fs.copy(path.join(SCRIPT_ROOT, 'shell-integration-env.zsh'), path.join(zdotdir, '.zshenv')),
    fs.copy(path.join(SCRIPT_ROOT, 'shell-integration-login.zsh'), path.join(zdotdir, '.zlogin'))
  ]);

  envMixin.ZDOTDIR = zdotdir;
  envMixin.USER_ZDOTDIR = env.ZDOTDIR ?? os.homedir() ?? '~';

  return { enabled: true, injection: { args, env: envMixin } };
}
