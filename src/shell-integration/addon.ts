// A minimal counterpart to VS Code's `ShellIntegrationAddon`
// (`src/vs/platform/terminal/common/xterm/shellIntegrationAddon.ts`,
// Copyright (c) Microsoft Corporation, MIT License).
//
// VS Code's version lazily builds out a whole `TerminalCapabilityStore`
// (command detection, cwd detection, buffer marks, prompt-type detection,
// shell-env detection...) as OSC 633 sequences arrive. This version tracks
// two things: `Cwd`, and a command-detection state machine driven by the
// `A`/`B`/`C`/`D`/`E` lifecycle letters. `F`/`G` (continuation prompt) and the
// `Env*`/`EnvJson` environment-reporting sequences are parsed just enough to
// be safely ignored — recognized, not acted upon — so this can grow further
// without changing the sequences it already understands.

import { Emitter } from 'atom';
import type { IDisposable, ITerminalAddon, Terminal } from '@xterm/xterm';

const OSC_SHELL_INTEGRATION = 633;

// A command, as tracked from the `E` (command line) and `C` (executed)
// sequences that start it through to the `D` (finished) sequence that ends
// it.
export type TerminalCommand = {
  // The literal command text. Only ever populated when `E`'s nonce checked
  // out — see the note on `#nonce` below — so treat `undefined` as "unknown,"
  // not "empty."
  commandLine: string | undefined;
  // The cwd as of the last `P;Cwd=` we saw, if any, at the time this command
  // started.
  cwd: string | undefined;
  // Populated once `D` arrives. `undefined` beforehand, and also `undefined`
  // for the "no command" case (the user hit enter on an empty line).
  exitCode: number | undefined;
};

// Reverses the escaping done by `__pulsar_escape_value` in
// `shell/shell-integration-bash.sh` (and its counterparts in the other
// scripts): backslashes are doubled, semicolons become `\x3b`, and other
// control characters become `\xHH`. All three forms start with a literal
// backslash, so a single left-to-right scan unambiguously reverses any of
// them.
function unescapeShellIntegrationValue (value: string): string {
  let out = '';
  for (let i = 0; i < value.length; i++) {
    if (value[i] !== '\\') {
      out += value[i];
      continue;
    }
    let next = value[i + 1];
    if (next === '\\') {
      out += '\\';
      i += 1;
    } else if (next === 'x') {
      let hex = value.slice(i + 2, i + 4);
      out += String.fromCharCode(parseInt(hex, 16));
      i += 3;
    } else {
      // Not a sequence we recognize; keep the backslash as-is rather than
      // silently dropping data.
      out += value[i];
    }
  }
  return out;
}

// Splits `key=value` on the first `=` only, since a value (e.g. a `Cwd`
// containing `=`) may legitimately contain more of them.
function splitProperty (data: string): [key: string, value: string] | undefined {
  let index = data.indexOf('=');
  if (index === -1) return undefined;
  return [data.slice(0, index), data.slice(index + 1)];
}

export class ShellIntegrationAddon implements ITerminalAddon {
  #disposable: IDisposable | undefined;
  #emitter = new Emitter();

  #lastCwd: string | undefined;

  // The nonce we expect trust-sensitive sequences (`E`, and eventually the
  // `Env*` ones) to carry. It's generated fresh per PTY spawn in
  // `getShellIntegrationInjection` and handed to us via `setNonce` — see
  // that module for why `Cwd` doesn't need this but `E` does. `undefined`
  // means "no nonce configured yet," which we treat the same as "mismatch":
  // fail closed rather than trust unverified command text.
  #nonce: string | undefined;

  // Command text reported by `E`, staged until the matching `C` arrives.
  #pendingCommandLine: string | undefined;

  // The command between `C` (started) and `D` (finished).
  #currentCommand: TerminalCommand | undefined;

  activate (terminal: Terminal) {
    this.#disposable = terminal.parser.registerOscHandler(
      OSC_SHELL_INTEGRATION,
      (data) => this.#handleSequence(data)
    );
  }

  dispose () {
    this.#disposable?.dispose();
    this.#emitter.dispose();
  }

  setNonce (nonce: string | undefined) {
    this.#nonce = nonce;
  }

  onDidChangeCwd (callback: (cwd: string) => void) {
    return this.#emitter.on('did-change-cwd', callback);
  }

  // Fired when a command starts executing (`C`), i.e. right after the user
  // presses enter and before its output appears.
  onDidExecuteCommand (callback: (command: TerminalCommand) => void) {
    return this.#emitter.on('did-execute-command', callback);
  }

  // Fired when a command finishes (`D`), with `exitCode` populated.
  onDidFinishCommand (callback: (command: TerminalCommand) => void) {
    return this.#emitter.on('did-finish-command', callback);
  }

  // Returning `true` tells xterm.js the sequence was recognized and should
  // not be passed along to anything else (e.g. printed as visible garbage).
  // We return `true` even for sequences we don't act on, since they're still
  // valid, recognized shell-integration sequences.
  #handleSequence (data: string): boolean {
    // Escaped values never contain a raw `;` (see `unescapeShellIntegrationValue`
    // above), so it's always safe to split the whole sequence on it.
    let parts = data.split(';');
    let command = parts[0];

    switch (command) {
      case 'P': {
        let property = splitProperty(parts[1] ?? '');
        if (!property) return true;
        let [key, rawValue] = property;
        if (key === 'Cwd') {
          this.#lastCwd = unescapeShellIntegrationValue(rawValue);
          this.#emitter.emit('did-change-cwd', this.#lastCwd);
        }
        return true;
      }
      case 'E': {
        // E ; <escaped command line> ; <nonce>
        let [rawCommandLine, nonce] = [parts[1] ?? '', parts[2]];
        if (nonce !== undefined && this.#nonce !== undefined && nonce === this.#nonce) {
          this.#pendingCommandLine = unescapeShellIntegrationValue(rawCommandLine);
        } else {
          // Untrusted or missing nonce: don't attribute this text to the
          // command that's about to run.
          this.#pendingCommandLine = undefined;
        }
        return true;
      }
      case 'C': {
        this.#currentCommand = {
          commandLine: this.#pendingCommandLine,
          cwd: this.#lastCwd,
          exitCode: undefined
        };
        this.#pendingCommandLine = undefined;
        this.#emitter.emit('did-execute-command', this.#currentCommand);
        return true;
      }
      case 'D': {
        // D [; <exit code>]. Can arrive with no matching `C` — e.g. the user
        // hit enter on an empty line, which never triggers a preexec hook —
        // in which case there's nothing to report.
        if (!this.#currentCommand) return true;
        let rawExitCode = parts[1];
        let exitCode = rawExitCode === undefined ? undefined : Number(rawExitCode);
        this.#currentCommand.exitCode = Number.isNaN(exitCode) ? undefined : exitCode;
        this.#emitter.emit('did-finish-command', this.#currentCommand);
        this.#currentCommand = undefined;
        return true;
      }
      // `A`/`B` (prompt start/end) and `F`/`G` (continuation prompt
      // start/end) are recognized but not yet acted upon, as are the
      // `EnvJson`/`EnvSingleStart`/`EnvSingleEntry`/`EnvSingleEnd`
      // environment-reporting sequences and the zsh-only `H`/`I`
      // (right-prompt start/end).
      default:
        return true;
    }
  }
}
