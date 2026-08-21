'use strict';

var tslib = require('tslib');
var fs = require('fs-extra');
var os = require('os');
var path = require('path');
var url = require('url');
var utils = require('../utils.js');
var pathParsing = require('./path-parsing.js');

function _interopDefault (e) { return e && e.__esModule ? e : { default: e }; }

var fs__default = /*#__PURE__*/_interopDefault(fs);
var os__default = /*#__PURE__*/_interopDefault(os);
var path__default = /*#__PURE__*/_interopDefault(path);

var _LocalPathLinkProvider_instances, _LocalPathLinkProvider_terminal, _LocalPathLinkProvider_getCwd, _LocalPathLinkProvider_activate, _LocalPathLinkProvider_provideLinks, _LocalPathLinkProvider_makeLink, _LocalPathLinkProvider_resolve;
// Detects local filesystem paths in terminal output text and offers them up
// as xterm.js links (`Terminal.registerLinkProvider`) — a different
// mechanism from `ShellIntegrationAddon`, which parses an OSC escape-sequence
// protocol rather than scanning rendered buffer text.
//
// Candidate detection lives in `./path-parsing` (adapted from VS Code); this
// class is responsible for the xterm.js-specific parts: reading buffer text
// (joining wrapped lines so a path split across a terminal-width boundary is
// still detected — see `getWindowedLineStrings` below, adapted from
// `@xterm/addon-web-links`'s `WebLinkProvider`, Copyright (c) 2019 The
// xterm.js authors, MIT License), resolving candidates against a live cwd,
// and validating them against the real filesystem.
class LocalPathLinkProvider {
    constructor(terminal, getCwd, activate) {
        _LocalPathLinkProvider_instances.add(this);
        _LocalPathLinkProvider_terminal.set(this, void 0);
        _LocalPathLinkProvider_getCwd.set(this, void 0);
        _LocalPathLinkProvider_activate.set(this, void 0);
        tslib.__classPrivateFieldSet(this, _LocalPathLinkProvider_terminal, terminal, "f");
        tslib.__classPrivateFieldSet(this, _LocalPathLinkProvider_getCwd, getCwd, "f");
        tslib.__classPrivateFieldSet(this, _LocalPathLinkProvider_activate, activate, "f");
    }
    provideLinks(bufferLineNumber, callback) {
        tslib.__classPrivateFieldGet(this, _LocalPathLinkProvider_instances, "m", _LocalPathLinkProvider_provideLinks).call(this, bufferLineNumber).then(callback);
    }
}
_LocalPathLinkProvider_terminal = new WeakMap(), _LocalPathLinkProvider_getCwd = new WeakMap(), _LocalPathLinkProvider_activate = new WeakMap(), _LocalPathLinkProvider_instances = new WeakSet(), _LocalPathLinkProvider_provideLinks = async function _LocalPathLinkProvider_provideLinks(bufferLineNumber) {
    const [lines, startLineIndex] = getWindowedLineStrings(bufferLineNumber - 1, tslib.__classPrivateFieldGet(this, _LocalPathLinkProvider_terminal, "f"));
    const text = lines.join('');
    if (!text || text.length > pathParsing.MAX_LINE_LENGTH)
        return undefined;
    const cwd = tslib.__classPrivateFieldGet(this, _LocalPathLinkProvider_getCwd, "f").call(this);
    const links = [];
    for (const parsed of pathParsing.detectLinks(text, utils.isWindows())) {
        if (parsed.path.text.length > pathParsing.MAX_RESOLVED_LINK_LENGTH)
            continue;
        const resolved = await tslib.__classPrivateFieldGet(this, _LocalPathLinkProvider_instances, "m", _LocalPathLinkProvider_resolve).call(this, parsed.path.text, cwd);
        if (!resolved)
            continue;
        const startIndex = parsed.prefix?.index ?? parsed.path.index;
        const endIndex = parsed.suffix
            ? parsed.suffix.suffix.index + parsed.suffix.suffix.text.length
            : parsed.path.index + parsed.path.text.length;
        const range = mapRangeToBuffer(tslib.__classPrivateFieldGet(this, _LocalPathLinkProvider_terminal, "f"), startLineIndex, startIndex, endIndex);
        if (!range)
            continue;
        links.push(tslib.__classPrivateFieldGet(this, _LocalPathLinkProvider_instances, "m", _LocalPathLinkProvider_makeLink).call(this, range, text.substring(startIndex, endIndex), resolved, parsed.suffix?.row, parsed.suffix?.col));
        if (links.length >= pathParsing.MAX_RESOLVED_LINKS_PER_LINE)
            break;
    }
    // Only try the (broader, more expensive) fallback matchers if regular
    // detection found nothing on this line.
    if (links.length === 0) {
        for (const matcher of pathParsing.fallbackPathMatchers) {
            const groups = text.match(matcher)?.groups;
            const link = groups?.link;
            const targetPath = groups?.path;
            if (!link || !targetPath || link.length > pathParsing.MAX_RESOLVED_LINK_LENGTH)
                continue;
            const resolved = await tslib.__classPrivateFieldGet(this, _LocalPathLinkProvider_instances, "m", _LocalPathLinkProvider_resolve).call(this, targetPath, cwd);
            if (!resolved)
                continue;
            const startIndex = text.indexOf(link);
            const range = mapRangeToBuffer(tslib.__classPrivateFieldGet(this, _LocalPathLinkProvider_terminal, "f"), startLineIndex, startIndex, startIndex + link.length);
            if (!range)
                continue;
            const line = groups.line ? Number(groups.line) : undefined;
            const column = groups.col ? Number(groups.col) : undefined;
            links.push(tslib.__classPrivateFieldGet(this, _LocalPathLinkProvider_instances, "m", _LocalPathLinkProvider_makeLink).call(this, range, link, resolved, line, column));
            break;
        }
    }
    return links.length > 0 ? links : undefined;
}, _LocalPathLinkProvider_makeLink = function _LocalPathLinkProvider_makeLink(range, text, resolved, line, column) {
    return {
        range,
        text,
        activate: (event) => tslib.__classPrivateFieldGet(this, _LocalPathLinkProvider_activate, "f").call(this, event, resolved.absolutePath, resolved.isDirectory, line, column)
    };
}, _LocalPathLinkProvider_resolve = async function _LocalPathLinkProvider_resolve(candidatePath, cwd) {
    for (const candidate of buildPathCandidates(candidatePath, cwd)) {
        try {
            const stats = await fs__default.default.lstat(candidate);
            return { absolutePath: candidate, isDirectory: stats.isDirectory() };
        }
        catch {
            // Not a real path; try the next candidate.
        }
    }
    return undefined;
};
// Expands a leading `~` (home directory shorthand) — but only a bare `~` or
// `~/...`, not `~otheruser`, since resolving another user's home directory
// isn't something we can do portably.
function expandTilde(candidatePath) {
    if (candidatePath === '~')
        return os__default.default.homedir();
    if (candidatePath.startsWith('~/') || (utils.isWindows() && candidatePath.startsWith('~\\'))) {
        return path__default.default.join(os__default.default.homedir(), candidatePath.slice(2));
    }
    return candidatePath;
}
// Builds the ordered list of paths to test against the filesystem for one
// parsed candidate: absolute paths (and `file://` URIs, and `~`-relative
// paths) are tried as-is; relative paths are resolved against the live cwd
// when known, with a `../`-stripped fallback (mirroring VS Code's
// `detect()`) for when no cwd is available.
function buildPathCandidates(candidatePath, cwd) {
    if (candidatePath.startsWith('file://')) {
        try {
            return [url.fileURLToPath(candidatePath)];
        }
        catch {
            return [];
        }
    }
    const expanded = expandTilde(candidatePath);
    if (path__default.default.isAbsolute(expanded))
        return [expanded];
    if (cwd)
        return [path__default.default.resolve(cwd, expanded)];
    const candidates = [expanded];
    const stripped = expanded.replace(/^(\.\.[/\\])+/, '');
    if (stripped !== expanded)
        candidates.push(stripped);
    return candidates;
}
function mapRangeToBuffer(terminal, startLineIndex, startIndex, endIndex) {
    const [startY, startX] = mapStrIdx(terminal, startLineIndex, 0, startIndex);
    const [endY, endX] = mapStrIdx(terminal, startY, startX, endIndex - startIndex);
    if (startY === -1 || startX === -1 || endY === -1 || endX === -1)
        return undefined;
    // Range coordinates are 1-based, end.x exclusive — see `WebLinkProvider`'s
    // `LinkComputer.computeLink`, which this mirrors.
    return {
        start: { x: startX + 1, y: startY + 1 },
        end: { x: endX, y: endY + 1 }
    };
}
// Gets the wrapped content lines around `lineIndex`, joined into a single
// string, along with the buffer index the joined string starts at. Adapted
// from `@xterm/addon-web-links`'s `WebLinkProvider._getWindowedLineStrings`.
function getWindowedLineStrings(lineIndex, terminal) {
    let line;
    let topIndex = lineIndex;
    let bottomIndex = lineIndex;
    let length = 0;
    let content = '';
    const lines = [];
    if ((line = terminal.buffer.active.getLine(lineIndex))) {
        const currentContent = line.translateToString(true);
        // Expand upward, stopping at whitespace or once we've gathered enough.
        if (line.isWrapped && currentContent[0] !== ' ') {
            length = 0;
            while ((line = terminal.buffer.active.getLine(--topIndex)) && length < 2048) {
                content = line.translateToString(true);
                length += content.length;
                lines.push(content);
                if (!line.isWrapped || content.indexOf(' ') !== -1)
                    break;
            }
            lines.reverse();
        }
        lines.push(currentContent);
        // Expand downward the same way.
        length = 0;
        while ((line = terminal.buffer.active.getLine(++bottomIndex)) && line.isWrapped && length < 2048) {
            content = line.translateToString(true);
            length += content.length;
            lines.push(content);
            if (content.indexOf(' ') !== -1)
                break;
        }
    }
    return [lines, topIndex];
}
// Maps a string index within the joined-line text back to a 0-based buffer
// position. Adapted from `WebLinkProvider._mapStrIdx`.
function mapStrIdx(terminal, lineIndex, rowIndex, stringIndex) {
    const buffer = terminal.buffer.active;
    const cell = buffer.getNullCell();
    let start = rowIndex;
    while (stringIndex) {
        const line = buffer.getLine(lineIndex);
        if (!line)
            return [-1, -1];
        for (let i = start; i < line.length; ++i) {
            line.getCell(i, cell);
            const chars = cell.getChars();
            const width = cell.getWidth();
            if (width) {
                stringIndex -= chars.length || 1;
                // Correct for a wide char that got wrapped early onto the next
                // line (see `WebLinkProvider._mapStrIdx` for the full rationale).
                if (i === line.length - 1 && chars === '') {
                    const nextLine = buffer.getLine(lineIndex + 1);
                    if (nextLine && nextLine.isWrapped) {
                        nextLine.getCell(0, cell);
                        if (cell.getWidth() === 2)
                            stringIndex += 1;
                    }
                }
            }
            if (stringIndex < 0)
                return [lineIndex, i];
        }
        lineIndex++;
        start = 0;
    }
    return [lineIndex, start];
}

exports.LocalPathLinkProvider = LocalPathLinkProvider;
//# sourceMappingURL=provider.js.map
