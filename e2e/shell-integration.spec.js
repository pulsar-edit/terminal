// Real end-to-end proof that shell integration works: a real installed
// Pulsar, this checkout loaded as a dev-mode package, a real login shell
// (not a mock PTY, unlike every other spec in this repo), and an actual
// `cd` typed into the terminal — verified by reading the live
// `TerminalModel.cwd` back out of the running app via `page.evaluate()`.
//
// This is the one thing `spec/shell-integration-spec.js` (injection-arg
// logic) and `spec/shell-integration-addon-spec.js` (OSC 633 parsing
// against a real `@xterm/xterm` `Terminal`, but synthetic bytes) can't
// prove on their own: that the shipped shell scripts actually emit correct
// sequences from a real shell startup, dotfiles and all.

const { test, expect } = require('@playwright/test');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { openPulsar, closePulsar, runCommand, readTerminalContents, waitForShellToSettle, TERMINAL_ELEMENT_SELECTOR } = require('./helpers');

// `openPulsar()` (e2e/helpers.js) launches Pulsar with `...process.env`, and
// `getDefaultShell()` (src/config.ts) defaults `terminal.shell` from `SHELL`
// in that environment — so this test already runs against whatever shell the
// CI workflow (or a local run) put there, with no shell-specific code below.
// `SHELL` isn't guaranteed to be set locally (unlike in CI, where the
// workflow always resolves and exports it), hence the fallback.
const SHELL_NAME = path.basename(process.env.SHELL || 'bash');

test.describe(`shell integration (${SHELL_NAME})`, () => {
  let app, page, tmpRoot, targetDir;

  test.beforeEach(async () => {
    ({ app, page, tmpRoot } = await openPulsar());

    // A real directory to `cd` into, so we're asserting against a value
    // that couldn't already be the terminal's starting cwd by coincidence.
    targetDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'terminal-e2e-target-'));
  });

  test.afterEach(async () => {
    await closePulsar({ app, tmpRoot });
    await fs.promises.rm(targetDir, { recursive: true, force: true });
  });

  test(`tracks cwd after a real \`cd\` in a real ${SHELL_NAME} shell`, async () => {
    // Not `Terminal: Open`: `Terminal.open()` deliberately opens wherever
    // the currently active pane container is (see the comment on that
    // method), and a freshly launched window starts with the tree-view
    // focused in the left dock — so the plain "open" command would land
    // the terminal there instead of the center, where the rest of this
    // test assumes it'll be interactable.
    await runCommand({ page }, 'Terminal: Open Center');

    // `workspace.open()` opens the terminal in the right pane, but Pulsar's
    // own auto-opened "Change Log" tab (shown on a version bump) can win
    // the race to be the *active* tab in that same pane. Atom only mounts a
    // pane item's view once it's the active item, so an inactive terminal
    // tab means the terminal element doesn't exist in the DOM at all yet —
    // not just hidden. Make sure it's actually active rather than assuming
    // `workspace.open()` left it that way.
    await page.locator('.tab-bar .tab', { hasText: 'Terminal' }).first().click();

    let terminalElement = page.locator(TERMINAL_ELEMENT_SELECTOR).first();
    await expect(terminalElement).toBeVisible();

    // Focus the real xterm.js input and drive an actual shell command —
    // no synthetic OSC bytes anywhere in this test.
    await terminalElement.locator('.terminal__terminal').click();

    // DOM visibility isn't proof the pty has finished spawning —
    // `TerminalElement`'s `onData` handler silently drops keystrokes typed
    // before `isPtyProcessRunning()` is true, with no queuing. Wait for the
    // real signal rather than racing it.
    await expect
      .poll(() => page.evaluate(
        (selector) => document.querySelector(selector)?.isPtyProcessRunning?.(),
        TERMINAL_ELEMENT_SELECTOR
      ))
      .toBe(true);

    // A running pty process isn't a running *shell* — it still has to
    // source its rc files (and, here, the injected shell-integration init
    // script) before it's actually reading input at a prompt. Typing before
    // that point risks keystrokes landing mid-startup, which showed up as
    // visibly corrupted input and, worse, seemed to interfere with the
    // integration script installing its prompt hooks at all.
    await waitForShellToSettle(page);

    await page.keyboard.type(`cd ${targetDir}\n`);

    try {
      await expect
        .poll(
          () => page.evaluate(() => atom.workspace.getActivePaneItem()?.cwd),
          { message: 'waiting for shell integration to report the new cwd', timeout: 20_000 }
        )
        .toBe(fs.realpathSync(targetDir));
    } catch (error) {
      // Shows whether the shell ever actually saw the `cd` (echoed onscreen,
      // a new prompt after it) versus shell integration parsing/reporting
      // the cwd change incorrectly.
      console.log('--- terminal contents at failure ---\n' + await readTerminalContents(page));
      throw error;
    }
  });
});
