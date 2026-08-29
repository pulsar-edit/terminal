// Adapted from VS Code's terminal link-parsing logic
// (`src/vs/workbench/contrib/terminalContrib/links/browser/terminalLinkParsing.ts`
// and `terminalLocalLinkDetector.ts`, Copyright (c) Microsoft Corporation, MIT
// License).
//
// This module only parses *candidate* paths out of a line of text; it does
// no filesystem validation (see `provider.ts` for that) and no xterm.js
// buffer/line-wrapping logic. VS Code additionally joins wrapped logical
// lines before parsing so that a path split across a terminal-width boundary
// is still detected (`getXtermLineContent`/`convertLinkRangeToBuffer`); we
// don't do that yet — see the TODO in `provider.ts`.
//
// Left out entirely, at least for now: VS Code's git-diff-line special
// casing in `detectPathsNoSuffix` (stripping a leading `a/`/`b/` from
// `diff --git` output) and its phase-3 attribute/styled-text fallback. Both
// are real complexity for comparatively rare payoff.

export interface ILinkPartialRange {
  index: number;
  text: string;
}

export interface ILinkSuffix {
  row: number | undefined;
  col: number | undefined;
  rowEnd: number | undefined;
  colEnd: number | undefined;
  suffix: ILinkPartialRange;
}

export interface IParsedLink {
  path: ILinkPartialRange;
  prefix?: ILinkPartialRange;
  suffix?: ILinkSuffix;
}

// The individual regex fragments paths are built out of. Kept as their own
// enum (as VS Code does) so the "why" of each exclusion stays attached to
// it — most notably, `\\` is excluded from `ExcludedPathCharactersClause` to
// avoid a catastrophic-backtracking case VS Code hit (microsoft/vscode#24795).
enum RegexPathConstants {
  PathPrefix = '(?:\\.\\.?|\\~|file:\\/\\/)',
  PathSeparatorClause = '\\/',
  // '":; are allowed in paths but they are often separators so ignore them.
  // Also disallow \\ to prevent a catastrophic backtracking case (see above).
  ExcludedPathCharactersClause = '[^\\0<>\\?\\s!`&*()\'":;\\\\]',
  ExcludedStartPathCharactersClause = '[^\\0<>\\?\\s!`&*()\\[\\]\'":;\\\\]',

  WinOtherPathPrefix = '\\.\\.?|\\~',
  WinPathSeparatorClause = '(?:\\\\|\\/)',
  WinExcludedPathCharactersClause = '[^\\0<>\\?\\|\\/\\s!`&*()\'":;]',
  WinExcludedStartPathCharactersClause = '[^\\0<>\\?\\|\\/\\s!`&*()\\[\\]\'":;]',
}

const unixLocalLinkClause = '(?:(?:' + RegexPathConstants.PathPrefix + '|(?:' +
  RegexPathConstants.ExcludedStartPathCharactersClause + RegexPathConstants.ExcludedPathCharactersClause +
  '*))?(?:' + RegexPathConstants.PathSeparatorClause + '(?:' + RegexPathConstants.ExcludedPathCharactersClause +
  ')+)+)';

// Matches a Windows drive letter, a `file:///` URI, or a `\\?\` UNC prefix.
export const winDrivePrefix = '(?:\\\\\\\\\\?\\\\|file:\\/\\/\\/)?[a-zA-Z]:';

const winLocalLinkClause = '(?:(?:' + `(?:${winDrivePrefix}|${RegexPathConstants.WinOtherPathPrefix})` +
  '|(?:' + RegexPathConstants.WinExcludedStartPathCharactersClause + RegexPathConstants.WinExcludedPathCharactersClause +
  '*))?(?:' + RegexPathConstants.WinPathSeparatorClause + '(?:' + RegexPathConstants.WinExcludedPathCharactersClause +
  ')+)+)';

// The tail-end-of-line path fragment a `:line:col`-style suffix is expected
// to be glued onto, e.g. matches `/foo/bar.js` out of `at /foo/bar.js:10:5`.
const linkWithSuffixPathCharacters = /(?<path>(?:file:\/\/\/)?[^\s|<>[({][^\s|<>]*)$/;

function generateLinkSuffixRegex (eolOnly: boolean): RegExp {
  let ri = 0;
  let ci = 0;
  let rei = 0;
  let cei = 0;
  function r (): string { return `(?<row${ri++}>\\d+)`; }
  function c (): string { return `(?<col${ci++}>\\d+)`; }
  function re (): string { return `(?<rowEnd${rei++}>\\d+)`; }
  function ce (): string { return `(?<colEnd${cei++}>\\d+)`; }

  const eolSuffix = eolOnly ? '$' : '';

  const lineAndColumnRegexClauses = [
    `(?::|#| |['"],|, )${r()}([:.]${c()}(?:-(?:${re()}\\.)?${ce()})?)?` + eolSuffix,
    `['"]?(?:,? |: ?| on )lines? ${r()}(?:-${re()})?(?:,? (?:col(?:umn)?|characters?) ${c()}(?:-${ce()})?)?` + eolSuffix,
    `:? ?[[(]${r()}(?:(?:, ?|:)${c()})?[\\])]` + eolSuffix,
  ];

  const suffixClause = lineAndColumnRegexClauses
    .join('|')
    .replace(/ /g, `[${'\u00A0'} ]`);

  return new RegExp(`(${suffixClause})`, eolOnly ? undefined : 'g');
}

const linkSuffixRegex = generateLinkSuffixRegex(false);

function parseIntOptional (value: string | undefined): number | undefined {
  if (value === undefined) return undefined;
  return parseInt(value);
}

function toLinkSuffix (match: RegExpExecArray | null): ILinkSuffix | null {
  const groups = match?.groups;
  if (!groups || match.length < 1) return null;
  return {
    row: parseIntOptional(groups.row0 || groups.row1 || groups.row2),
    col: parseIntOptional(groups.col0 || groups.col1 || groups.col2),
    rowEnd: parseIntOptional(groups.rowEnd0 || groups.rowEnd1 || groups.rowEnd2),
    colEnd: parseIntOptional(groups.colEnd0 || groups.colEnd1 || groups.colEnd2),
    suffix: { index: match.index, text: match[0] }
  };
}

function detectLinkSuffixes (line: string): ILinkSuffix[] {
  let match: RegExpExecArray | null;
  const results: ILinkSuffix[] = [];
  linkSuffixRegex.lastIndex = 0;
  while ((match = linkSuffixRegex.exec(line)) !== null) {
    const suffix = toLinkSuffix(match);
    if (suffix === null) break;
    results.push(suffix);
  }
  return results;
}

function binaryInsert (list: IParsedLink[], newItem: IParsedLink, low: number, high: number) {
  if (list.length === 0) {
    list.push(newItem);
    return;
  }
  if (low > high) return;
  const mid = Math.floor((low + high) / 2);
  if (
    mid >= list.length ||
    (newItem.path.index < list[mid].path.index && (mid === 0 || newItem.path.index > list[mid - 1].path.index))
  ) {
    if (
      mid >= list.length ||
      (newItem.path.index + newItem.path.text.length < list[mid].path.index && (mid === 0 || newItem.path.index > list[mid - 1].path.index + list[mid - 1].path.text.length))
    ) {
      list.splice(mid, 0, newItem);
    }
    return;
  }
  if (newItem.path.index > list[mid].path.index) {
    binaryInsert(list, newItem, mid + 1, high);
  } else {
    binaryInsert(list, newItem, low, mid - 1);
  }
}

// Merges `newItems` into `list` (both kept sorted, non-overlapping, by
// `path.index`), in place.
function binaryInsertList (list: IParsedLink[], newItems: IParsedLink[]) {
  if (list.length === 0) {
    list.push(...newItems);
    return;
  }
  for (const item of newItems) {
    binaryInsert(list, item, 0, list.length);
  }
}

function detectLinksViaSuffix (line: string): IParsedLink[] {
  const results: IParsedLink[] = [];
  const suffixes = detectLinkSuffixes(line);
  for (const suffix of suffixes) {
    const suffixEndIndex = suffix.suffix.index + suffix.suffix.text.length;
    if (line[suffixEndIndex] === '/') continue;

    const beforeSuffix = line.substring(0, suffix.suffix.index);
    const possiblePathMatch = beforeSuffix.match(linkWithSuffixPathCharacters);
    if (!possiblePathMatch || possiblePathMatch.index === undefined || !possiblePathMatch.groups?.path) {
      continue;
    }

    let linkStartIndex = possiblePathMatch.index;
    let path = possiblePathMatch.groups.path;
    let prefix: ILinkPartialRange | undefined;

    const prefixMatch = path.match(/^(?<prefix>['"]+)/);
    if (prefixMatch?.groups?.prefix) {
      prefix = { index: linkStartIndex, text: prefixMatch.groups.prefix };
      path = path.substring(prefix.text.length);
      if (path.trim().length === 0) continue;
      if (prefixMatch.groups.prefix.length > 1) {
        if (
          suffix.suffix.text[0].match(/['"]/) &&
          prefixMatch.groups.prefix[prefixMatch.groups.prefix.length - 1] === suffix.suffix.text[0]
        ) {
          const trimPrefixAmount = prefixMatch.groups.prefix.length - 1;
          prefix.index += trimPrefixAmount;
          prefix.text = prefixMatch.groups.prefix[prefixMatch.groups.prefix.length - 1];
          linkStartIndex += trimPrefixAmount;
        }
      }
    }

    results.push({
      path: { index: linkStartIndex + (prefix?.text.length || 0), text: path },
      prefix,
      suffix
    });

    // A suffix can also apply to a path nested inside an opening bracket,
    // e.g. `(see foo/bar.js:10)` should also yield `foo/bar.js:10`.
    const openingBracketMatches = path.matchAll(/(?<bracket>[[(])(?![\])])/g);
    for (const match of openingBracketMatches) {
      const bracket = match.groups?.bracket;
      if (!bracket || match.index === undefined) continue;
      results.push({
        path: {
          index: linkStartIndex + (prefix?.text.length || 0) + match.index + 1,
          text: path.substring(match.index + bracket.length)
        },
        prefix,
        suffix
      });
    }
  }
  return results;
}

function detectPathsNoSuffix (line: string, forWindows: boolean): IParsedLink[] {
  const results: IParsedLink[] = [];
  const regex = new RegExp(forWindows ? winLocalLinkClause : unixLocalLinkClause, 'g');
  let match: RegExpExecArray | null;
  while ((match = regex.exec(line)) !== null) {
    const text = match[0];
    if (!text) break;
    results.push({ path: { index: match.index, text }, prefix: undefined, suffix: undefined });
  }
  return results;
}

// Detects candidate paths in `line`, both those with a `:line:col`-style
// suffix and bare paths without one. Ranges are merged so overlapping
// candidates don't produce duplicate links.
export function detectLinks (line: string, forWindows: boolean): IParsedLink[] {
  const results = detectLinksViaSuffix(line);
  const noSuffixPaths = detectPathsNoSuffix(line, forWindows);
  binaryInsertList(results, noSuffixPaths);
  return results;
}

// Phase-2 fallback matchers, tried only when `detectLinks` finds nothing on
// a line. These exist for paths containing spaces, which the regexes above
// can't safely handle (there's no way to tell a space-in-a-path from a
// word boundary). Order matters: more specific patterns first. The last
// entry ("the whole line is the path") is intentionally broad — it's safe
// because callers only treat a match as a real link once it resolves
// against the filesystem.
export const fallbackPathMatchers: RegExp[] = [
  // Python style error: File "<path>", line <line>
  /^ *File (?<link>"(?<path>.+)"(, line (?<line>\d+))?)/,
  // Some C++ compile error formats:
  //   C:\foo\bar baz(339) : error ...
  //   C:\foo\bar baz(339,12) : error ...
  //   C:\foo\bar baz(339, 12): error ...
  /^(?<link>(?<path>.+)\((?<line>\d+)(?:, ?(?<col>\d+))?\)) ?:/,
  // C:\foo/bar baz:339 : error ...
  // C:\foo/bar baz:339:12: error ...      [Clang-style]
  /^(?<link>(?<path>.+):(?<line>\d+)(?::(?<col>\d+))?) ?:/,
  // PowerShell and cmd prompt
  /^(?:PS\s+)?(?<link>(?<path>[^>]+))>/,
  // The whole line is the path
  /^ *(?<link>(?<path>.+))/
];

export const MAX_LINE_LENGTH = 2000;
export const MAX_RESOLVED_LINKS_PER_LINE = 10;
export const MAX_RESOLVED_LINK_LENGTH = 1024;
