// Adapted from `pulsar-edit/pulsar`'s own smoke-test helper
// (`integration/helpers.js`'s `openAtom()`/`runCommand()`), which proves the
// underlying launch mechanism (Playwright's `_electron.launch()` attaching
// to a real, packaged Pulsar build) already works in production CI. The
// adaptation here is launching an *installed* Pulsar (via
// `pulsar-edit/action-pulsar-dependency`, not one built fresh in-repo) with
// this checkout loaded as a dev-mode package (`--dev`), rather than Pulsar
// testing itself.

const fs = require('fs');
const os = require('os');
const path = require('path');
const playwright = require('playwright');
const electron = playwright._electron;
const { expect } = require('@playwright/test');

const REPO_ROOT = path.resolve(__dirname, '..');

// Matches `TERMINAL_ELEMENT_ATTRIBUTE` in src/element.ts — the element sets
// this on itself in `initialize()`. A CSS attribute selector rather than
// the tag name so this stays correct regardless of what the tag is
// currently called (see `getElementName()` in src/utils.ts for why it can
// vary at runtime).
const TERMINAL_ELEMENT_SELECTOR = '[data-pulsar-terminal]';

// Launches Pulsar with this checkout active as a dev-mode package, inside a
// disposable `ATOM_HOME` (Pulsar's own config/state) and `HOME` (so real
// dotfiles on the runner's default account can't leak into what's supposed
// to be a controlled shell-integration test — see the `ZDOTDIR` isolation
// `injectZsh()` already does for the same reason, in
// `src/shell-integration/index.ts`).
//
// `homeSetup(homeDir)`, if given, runs before launch so a test can drop in
// whatever dotfiles it needs for the shell under test (or none, to prove
// shell integration works against a shell's out-of-the-box defaults).
async function openPulsar ({ homeSetup } = {}) {
  let tmpRoot = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'terminal-e2e-'));
  let atomHome = path.join(tmpRoot, 'atom-home');
  let shellHome = path.join(tmpRoot, 'shell-home');
  await fs.promises.mkdir(atomHome, { recursive: true });
  await fs.promises.mkdir(shellHome, { recursive: true });

  // Passing `REPO_ROOT` as a positional `--dev` arg below opens it as a
  // *project*, not as a package — it does not register this checkout as
  // the `terminal` package. Without this link, Pulsar activates whatever
  // `terminal` package it already ships bundled (an older stock version),
  // this checkout never loads at all, and every test in this suite is
  // silently exercising the wrong code. This replicates what
  // `ppm link --dev <path>` does: a symlink under `$ATOM_HOME/dev/packages/`
  // named after the package, which dev-mode package loading picks up (and
  // which takes priority over a same-named bundled/community package).
  let devPackagesDir = path.join(atomHome, 'dev', 'packages');
  await fs.promises.mkdir(devPackagesDir, { recursive: true });
  await fs.promises.symlink(REPO_ROOT, path.join(devPackagesDir, 'terminal'), 'dir');

  if (homeSetup) await homeSetup(shellHome);

  let env = {
    ...process.env,
    ATOM_HOME: atomHome,
    HOME: shellHome
  };

  let config = {
    args: ['--no-sandbox', '--dev', REPO_ROOT],
    cwd: REPO_ROOT,
    env,
    timeout: 60_000
  };

  // `BINARY_NAME` is set by the CI workflow to the real Electron executable
  // inside whatever `action-pulsar-dependency` installed — see that
  // workflow for the per-OS path. Locally (no `BINARY_NAME`), this falls
  // back to whatever `pulsar` resolves to on the running machine's PATH,
  // which won't work as an `executablePath` directly, so local runs are
  // expected to set `BINARY_NAME` themselves.
  if (env.BINARY_NAME) {
    config.executablePath = env.BINARY_NAME;
  }

  let app = await electron.launch(config);
  let page = await app.firstWindow();
  await expect(page.locator('.tab-bar').first()).toBeVisible();

  // `.tab-bar` being visible only proves Pulsar's core UI rendered — this
  // package declares `activationHooks: ["core:loaded-shell-environment"]`
  // in package.json, so it stays fully inactive (no `activate()`, no config
  // schema registered with Atom — `atom.config.get('terminal.<anything>')`
  // returns `undefined` rather than any schema default) until that hook
  // fires, which happens only once Pulsar finishes spawning a real login
  // shell to capture PATH/env. That's a separate, variable-duration async
  // step. The headless jasmine suite sidesteps this by triggering the hook
  // manually (see `activatePackage()` in `spec/helpers.js`); a real app
  // has no such shortcut, so wait for genuine activation instead.
  await expect
    .poll(() => page.evaluate(() => atom.packages.isPackageActive('terminal')))
    .toBe(true);

  // `isPackageActive` can apparently go true slightly before (or
  // concurrently with) `activate()` actually finishing — a real terminal
  // open, dispatched right after this flag flips, once hit `document.
  // createElement()` before `registerTerminalElement()` had run, producing
  // an inert, undefined custom element with none of TerminalElement's
  // methods. Wait for the actual, specific signal instead of the proxy for
  // it: `Terminal.activated` (src/terminal.ts) is set as the very first
  // statement inside `activate()`, and `registerTerminalElement()` runs
  // synchronously right after it with no `await` in between — JS can't
  // yield back to the event loop mid-synchronous-execution, so no external
  // `page.evaluate()` call can ever observe `activated === true` before
  // registration has already happened, whatever tag name it claims.
  await expect
    .poll(() => page.evaluate(() => !!atom.packages.getActivePackage('terminal')?.mainModule?.activated))
    .toBe(true);

  return { app, page, tmpRoot };
}

async function closePulsar ({ app, tmpRoot }) {
  await app.close();
  await fs.promises.rm(tmpRoot, { recursive: true, force: true });
}

// Runs a Pulsar command via the command palette, the same interaction
// pattern as `pulsar-edit/pulsar`'s own `runCommand()`.
async function runCommand ({ page }, command) {
  let modifier = os.platform() === 'darwin' ? 'Meta+Shift+p' : 'Control+Shift+p';
  await page.locator('atom-workspace').press(modifier);
  await expect(page.locator('atom-panel.modal:visible')).toBeVisible();
  let palette = page.locator('.command-palette atom-text-editor.is-focused');
  await palette.type(command);
  await page.locator('.selected div', { hasText: command }).first().click();
  await expect(page.locator('.modal:visible')).toBeHidden();
}

// Reads the terminal's full rendered buffer text via the real xterm.js
// instance — used to detect when a real shell has actually finished
// starting up.
async function readTerminalContents (page) {
  return page.evaluate((selector) => {
    let terminal = document.querySelector(selector)?.terminal;
    if (!terminal) return null;
    let lines = [];
    for (let i = 0; i < terminal.buffer.active.length; i++) {
      lines.push(terminal.buffer.active.getLine(i)?.translateToString(true));
    }
    return lines.join('\n');
  }, TERMINAL_ELEMENT_SELECTOR);
}

// `isPtyProcessRunning()` only proves the pty process has spawned — it says
// nothing about whether the shell inside it has finished sourcing its rc
// files (and, for shell-integration tests, the injected init script) and
// actually reached an interactive prompt. Typing before that point risks
// keystrokes landing mid-startup, which can visibly corrupt the first
// command and can interfere with the injected init script itself. There's
// no cheap public "shell is interactive now" hook to poll instead, so this
// waits for the terminal's rendered output to stop changing — a real shell
// idling at a prompt produces no further output on its own.
async function waitForShellToSettle (page, { settleMs = 300, pollMs = 100, timeoutMs = 20_000 } = {}) {
  let deadline = Date.now() + timeoutMs;
  let previous = null;
  let stableSince = null;
  while (Date.now() < deadline) {
    let current = await readTerminalContents(page);
    if (current !== null && current.trim() !== '') {
      if (current === previous) {
        stableSince ??= Date.now();
        if (Date.now() - stableSince >= settleMs) return current;
      } else {
        stableSince = null;
      }
    }
    previous = current;
    await new Promise(r => setTimeout(r, pollMs));
  }
  throw new Error(`Timed out after ${timeoutMs}ms waiting for the terminal to settle at a prompt`);
}

module.exports = {
  openPulsar,
  closePulsar,
  runCommand,
  readTerminalContents,
  waitForShellToSettle,
  TERMINAL_ELEMENT_SELECTOR
};
