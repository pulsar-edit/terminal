import fs from 'fs-extra';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';

import type { IBufferLine, IBufferRange, ILink, ILinkProvider, Terminal } from '@xterm/xterm';

import { isWindows } from '../utils';
import {
  detectLinks,
  fallbackPathMatchers,
  MAX_LINE_LENGTH,
  MAX_RESOLVED_LINK_LENGTH,
  MAX_RESOLVED_LINKS_PER_LINE
} from './path-parsing';

// `line`/`column` are 1-based (as printed in tool output, e.g. `foo.js:10:5`)
// and only present when a suffix was detected.
export type LocalPathActivateHandler = (
  event: MouseEvent,
  targetPath: string,
  isDirectory: boolean,
  line?: number,
  column?: number
) => void;

type ResolvedPath = {
  absolutePath: string;
  isDirectory: boolean;
};

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
export class LocalPathLinkProvider implements ILinkProvider {
  #terminal: Terminal;
  #getCwd: () => string | undefined;
  #activate: LocalPathActivateHandler;

  constructor (terminal: Terminal, getCwd: () => string | undefined, activate: LocalPathActivateHandler) {
    this.#terminal = terminal;
    this.#getCwd = getCwd;
    this.#activate = activate;
  }

  provideLinks (bufferLineNumber: number, callback: (links: ILink[] | undefined) => void): void {
    this.#provideLinks(bufferLineNumber).then(callback);
  }

  async #provideLinks (bufferLineNumber: number): Promise<ILink[] | undefined> {
    const [lines, startLineIndex] = getWindowedLineStrings(bufferLineNumber - 1, this.#terminal);
    const text = lines.join('');
    if (!text || text.length > MAX_LINE_LENGTH) return undefined;

    const cwd = this.#getCwd();
    const links: ILink[] = [];

    for (const parsed of detectLinks(text, isWindows())) {
      if (parsed.path.text.length > MAX_RESOLVED_LINK_LENGTH) continue;

      const resolved = await this.#resolve(parsed.path.text, cwd);
      if (!resolved) continue;

      const startIndex = parsed.prefix?.index ?? parsed.path.index;
      const endIndex = parsed.suffix
        ? parsed.suffix.suffix.index + parsed.suffix.suffix.text.length
        : parsed.path.index + parsed.path.text.length;

      const range = mapRangeToBuffer(this.#terminal, startLineIndex, startIndex, endIndex);
      if (!range) continue;

      links.push(this.#makeLink(range, text.substring(startIndex, endIndex), resolved, parsed.suffix?.row, parsed.suffix?.col));
      if (links.length >= MAX_RESOLVED_LINKS_PER_LINE) break;
    }

    // Only try the (broader, more expensive) fallback matchers if regular
    // detection found nothing on this line.
    if (links.length === 0) {
      for (const matcher of fallbackPathMatchers) {
        const groups = text.match(matcher)?.groups;
        const link = groups?.link;
        const targetPath = groups?.path;
        if (!link || !targetPath || link.length > MAX_RESOLVED_LINK_LENGTH) continue;

        const resolved = await this.#resolve(targetPath, cwd);
        if (!resolved) continue;

        const startIndex = text.indexOf(link);
        const range = mapRangeToBuffer(this.#terminal, startLineIndex, startIndex, startIndex + link.length);
        if (!range) continue;

        const line = groups.line ? Number(groups.line) : undefined;
        const column = groups.col ? Number(groups.col) : undefined;
        links.push(this.#makeLink(range, link, resolved, line, column));
        break;
      }
    }

    return links.length > 0 ? links : undefined;
  }

  #makeLink (range: IBufferRange, text: string, resolved: ResolvedPath, line?: number, column?: number): ILink {
    return {
      range,
      text,
      activate: (event: MouseEvent) => this.#activate(event, resolved.absolutePath, resolved.isDirectory, line, column)
    };
  }

  async #resolve (candidatePath: string, cwd: string | undefined): Promise<ResolvedPath | undefined> {
    for (const candidate of buildPathCandidates(candidatePath, cwd)) {
      try {
        const stats = await fs.lstat(candidate);
        return { absolutePath: candidate, isDirectory: stats.isDirectory() };
      } catch {
        // Not a real path; try the next candidate.
      }
    }
    return undefined;
  }
}

// Expands a leading `~` (home directory shorthand) — but only a bare `~` or
// `~/...`, not `~otheruser`, since resolving another user's home directory
// isn't something we can do portably.
function expandTilde (candidatePath: string): string {
  if (candidatePath === '~') return os.homedir();
  if (candidatePath.startsWith('~/') || (isWindows() && candidatePath.startsWith('~\\'))) {
    return path.join(os.homedir(), candidatePath.slice(2));
  }
  return candidatePath;
}

// Builds the ordered list of paths to test against the filesystem for one
// parsed candidate: absolute paths (and `file://` URIs, and `~`-relative
// paths) are tried as-is; relative paths are resolved against the live cwd
// when known, with a `../`-stripped fallback (mirroring VS Code's
// `detect()`) for when no cwd is available.
function buildPathCandidates (candidatePath: string, cwd: string | undefined): string[] {
  if (candidatePath.startsWith('file://')) {
    try {
      return [fileURLToPath(candidatePath)];
    } catch {
      return [];
    }
  }

  const expanded = expandTilde(candidatePath);
  if (path.isAbsolute(expanded)) return [expanded];

  if (cwd) return [path.resolve(cwd, expanded)];

  const candidates = [expanded];
  const stripped = expanded.replace(/^(\.\.[/\\])+/, '');
  if (stripped !== expanded) candidates.push(stripped);
  return candidates;
}

function mapRangeToBuffer (terminal: Terminal, startLineIndex: number, startIndex: number, endIndex: number): IBufferRange | undefined {
  const [startY, startX] = mapStrIdx(terminal, startLineIndex, 0, startIndex);
  const [endY, endX] = mapStrIdx(terminal, startY, startX, endIndex - startIndex);
  if (startY === -1 || startX === -1 || endY === -1 || endX === -1) return undefined;

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
function getWindowedLineStrings (lineIndex: number, terminal: Terminal): [string[], number] {
  let line: IBufferLine | undefined;
  let topIndex = lineIndex;
  let bottomIndex = lineIndex;
  let length = 0;
  let content = '';
  const lines: string[] = [];

  if ((line = terminal.buffer.active.getLine(lineIndex))) {
    const currentContent = line.translateToString(true);

    // Expand upward, stopping at whitespace or once we've gathered enough.
    if (line.isWrapped && currentContent[0] !== ' ') {
      length = 0;
      while ((line = terminal.buffer.active.getLine(--topIndex)) && length < 2048) {
        content = line.translateToString(true);
        length += content.length;
        lines.push(content);
        if (!line.isWrapped || content.indexOf(' ') !== -1) break;
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
      if (content.indexOf(' ') !== -1) break;
    }
  }
  return [lines, topIndex];
}

// Maps a string index within the joined-line text back to a 0-based buffer
// position. Adapted from `WebLinkProvider._mapStrIdx`.
function mapStrIdx (terminal: Terminal, lineIndex: number, rowIndex: number, stringIndex: number): [number, number] {
  const buffer = terminal.buffer.active;
  const cell = buffer.getNullCell();
  let start = rowIndex;
  while (stringIndex) {
    const line = buffer.getLine(lineIndex);
    if (!line) return [-1, -1];
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
            if (cell.getWidth() === 2) stringIndex += 1;
          }
        }
      }
      if (stringIndex < 0) return [lineIndex, i];
    }
    lineIndex++;
    start = 0;
  }
  return [lineIndex, start];
}
