'use strict';

var tslib = require('tslib');
var atom = require('atom');

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
var _ShellIntegrationAddon_instances, _ShellIntegrationAddon_disposable, _ShellIntegrationAddon_emitter, _ShellIntegrationAddon_lastCwd, _ShellIntegrationAddon_nonce, _ShellIntegrationAddon_pendingCommandLine, _ShellIntegrationAddon_currentCommand, _ShellIntegrationAddon_handleSequence;
const OSC_SHELL_INTEGRATION = 633;
// Reverses the escaping done by `__pulsar_escape_value` in
// `shell/shell-integration-bash.sh` (and its counterparts in the other
// scripts): backslashes are doubled, semicolons become `\x3b`, and other
// control characters become `\xHH`. All three forms start with a literal
// backslash, so a single left-to-right scan unambiguously reverses any of
// them.
function unescapeShellIntegrationValue(value) {
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
        }
        else if (next === 'x') {
            let hex = value.slice(i + 2, i + 4);
            out += String.fromCharCode(parseInt(hex, 16));
            i += 3;
        }
        else {
            // Not a sequence we recognize; keep the backslash as-is rather than
            // silently dropping data.
            out += value[i];
        }
    }
    return out;
}
// Splits `key=value` on the first `=` only, since a value (e.g. a `Cwd`
// containing `=`) may legitimately contain more of them.
function splitProperty(data) {
    let index = data.indexOf('=');
    if (index === -1)
        return undefined;
    return [data.slice(0, index), data.slice(index + 1)];
}
class ShellIntegrationAddon {
    constructor() {
        _ShellIntegrationAddon_instances.add(this);
        _ShellIntegrationAddon_disposable.set(this, void 0);
        _ShellIntegrationAddon_emitter.set(this, new atom.Emitter());
        _ShellIntegrationAddon_lastCwd.set(this, void 0);
        // The nonce we expect trust-sensitive sequences (`E`, and eventually the
        // `Env*` ones) to carry. It's generated fresh per PTY spawn in
        // `getShellIntegrationInjection` and handed to us via `setNonce` — see
        // that module for why `Cwd` doesn't need this but `E` does. `undefined`
        // means "no nonce configured yet," which we treat the same as "mismatch":
        // fail closed rather than trust unverified command text.
        _ShellIntegrationAddon_nonce.set(this, void 0);
        // Command text reported by `E`, staged until the matching `C` arrives.
        _ShellIntegrationAddon_pendingCommandLine.set(this, void 0);
        // The command between `C` (started) and `D` (finished).
        _ShellIntegrationAddon_currentCommand.set(this, void 0);
    }
    activate(terminal) {
        tslib.__classPrivateFieldSet(this, _ShellIntegrationAddon_disposable, terminal.parser.registerOscHandler(OSC_SHELL_INTEGRATION, (data) => tslib.__classPrivateFieldGet(this, _ShellIntegrationAddon_instances, "m", _ShellIntegrationAddon_handleSequence).call(this, data)), "f");
    }
    dispose() {
        tslib.__classPrivateFieldGet(this, _ShellIntegrationAddon_disposable, "f")?.dispose();
        tslib.__classPrivateFieldGet(this, _ShellIntegrationAddon_emitter, "f").dispose();
    }
    setNonce(nonce) {
        tslib.__classPrivateFieldSet(this, _ShellIntegrationAddon_nonce, nonce, "f");
    }
    onDidChangeCwd(callback) {
        return tslib.__classPrivateFieldGet(this, _ShellIntegrationAddon_emitter, "f").on('did-change-cwd', callback);
    }
    // Fired when a command starts executing (`C`), i.e. right after the user
    // presses enter and before its output appears.
    onDidExecuteCommand(callback) {
        return tslib.__classPrivateFieldGet(this, _ShellIntegrationAddon_emitter, "f").on('did-execute-command', callback);
    }
    // Fired when a command finishes (`D`), with `exitCode` populated.
    onDidFinishCommand(callback) {
        return tslib.__classPrivateFieldGet(this, _ShellIntegrationAddon_emitter, "f").on('did-finish-command', callback);
    }
}
_ShellIntegrationAddon_disposable = new WeakMap(), _ShellIntegrationAddon_emitter = new WeakMap(), _ShellIntegrationAddon_lastCwd = new WeakMap(), _ShellIntegrationAddon_nonce = new WeakMap(), _ShellIntegrationAddon_pendingCommandLine = new WeakMap(), _ShellIntegrationAddon_currentCommand = new WeakMap(), _ShellIntegrationAddon_instances = new WeakSet(), _ShellIntegrationAddon_handleSequence = function _ShellIntegrationAddon_handleSequence(data) {
    // Escaped values never contain a raw `;` (see `unescapeShellIntegrationValue`
    // above), so it's always safe to split the whole sequence on it.
    let parts = data.split(';');
    let command = parts[0];
    switch (command) {
        case 'P': {
            let property = splitProperty(parts[1] ?? '');
            if (!property)
                return true;
            let [key, rawValue] = property;
            if (key === 'Cwd') {
                tslib.__classPrivateFieldSet(this, _ShellIntegrationAddon_lastCwd, unescapeShellIntegrationValue(rawValue), "f");
                tslib.__classPrivateFieldGet(this, _ShellIntegrationAddon_emitter, "f").emit('did-change-cwd', tslib.__classPrivateFieldGet(this, _ShellIntegrationAddon_lastCwd, "f"));
            }
            return true;
        }
        case 'E': {
            // E ; <escaped command line> ; <nonce>
            let [rawCommandLine, nonce] = [parts[1] ?? '', parts[2]];
            if (nonce !== undefined && tslib.__classPrivateFieldGet(this, _ShellIntegrationAddon_nonce, "f") !== undefined && nonce === tslib.__classPrivateFieldGet(this, _ShellIntegrationAddon_nonce, "f")) {
                tslib.__classPrivateFieldSet(this, _ShellIntegrationAddon_pendingCommandLine, unescapeShellIntegrationValue(rawCommandLine), "f");
            }
            else {
                // Untrusted or missing nonce: don't attribute this text to the
                // command that's about to run.
                tslib.__classPrivateFieldSet(this, _ShellIntegrationAddon_pendingCommandLine, undefined, "f");
            }
            return true;
        }
        case 'C': {
            tslib.__classPrivateFieldSet(this, _ShellIntegrationAddon_currentCommand, {
                commandLine: tslib.__classPrivateFieldGet(this, _ShellIntegrationAddon_pendingCommandLine, "f"),
                cwd: tslib.__classPrivateFieldGet(this, _ShellIntegrationAddon_lastCwd, "f"),
                exitCode: undefined
            }, "f");
            tslib.__classPrivateFieldSet(this, _ShellIntegrationAddon_pendingCommandLine, undefined, "f");
            tslib.__classPrivateFieldGet(this, _ShellIntegrationAddon_emitter, "f").emit('did-execute-command', tslib.__classPrivateFieldGet(this, _ShellIntegrationAddon_currentCommand, "f"));
            return true;
        }
        case 'D': {
            // D [; <exit code>]. Can arrive with no matching `C` — e.g. the user
            // hit enter on an empty line, which never triggers a preexec hook —
            // in which case there's nothing to report.
            if (!tslib.__classPrivateFieldGet(this, _ShellIntegrationAddon_currentCommand, "f"))
                return true;
            let rawExitCode = parts[1];
            let exitCode = rawExitCode === undefined ? undefined : Number(rawExitCode);
            tslib.__classPrivateFieldGet(this, _ShellIntegrationAddon_currentCommand, "f").exitCode = Number.isNaN(exitCode) ? undefined : exitCode;
            tslib.__classPrivateFieldGet(this, _ShellIntegrationAddon_emitter, "f").emit('did-finish-command', tslib.__classPrivateFieldGet(this, _ShellIntegrationAddon_currentCommand, "f"));
            tslib.__classPrivateFieldSet(this, _ShellIntegrationAddon_currentCommand, undefined, "f");
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
};

exports.ShellIntegrationAddon = ShellIntegrationAddon;
//# sourceMappingURL=addon.js.map
