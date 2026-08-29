const {
  detectLinks,
  fallbackPathMatchers
} = require('../lib/link-detection/path-parsing');

describe('detectLinks', () => {
  it('detects a simple absolute unix path', () => {
    let results = detectLinks('/foo/bar/baz.js', false);
    expect(results.length).toBe(1);
    expect(results[0].path.text).toBe('/foo/bar/baz.js');
    expect(results[0].path.index).toBe(0);
  });

  it('detects a relative path with a leading ./', () => {
    let results = detectLinks('run ./scripts/build.sh now', false);
    let paths = results.map((r) => r.path.text);
    expect(paths).toContain('./scripts/build.sh');
  });

  it('detects a ~-relative path', () => {
    let results = detectLinks('edit ~/notes/todo.md please', false);
    let paths = results.map((r) => r.path.text);
    expect(paths).toContain('~/notes/todo.md');
  });

  it('detects a path embedded in a sentence with a :line:col suffix', () => {
    let results = detectLinks('Error at /foo/bar.js:10:5 during build', false);
    expect(results.length).toBeGreaterThan(0);
    let withSuffix = results.find((r) => r.suffix);
    expect(withSuffix).toBeTruthy();
    expect(withSuffix.path.text).toBe('/foo/bar.js');
    expect(withSuffix.suffix.row).toBe(10);
    expect(withSuffix.suffix.col).toBe(5);
  });

  it('does not include the suffix text in the path', () => {
    let results = detectLinks('/foo/bar.js:10:5', false);
    let withSuffix = results.find((r) => r.suffix);
    expect(withSuffix.path.text).toBe('/foo/bar.js');
  });

  it('detects windows-style paths when forWindows is true', () => {
    let results = detectLinks('C:\\Users\\andrew\\file.txt', true);
    let paths = results.map((r) => r.path.text);
    expect(paths).toContain('C:\\Users\\andrew\\file.txt');
  });

  it('does not treat a plain word as a path', () => {
    let results = detectLinks('hello world', false);
    expect(results.length).toBe(0);
  });

  it('merges suffix and non-suffix candidates without duplicating overlapping ranges', () => {
    let results = detectLinks('/foo/bar.js:10:5', false);
    // The suffix-aware pass and the no-suffix pass would both notice
    // `/foo/bar.js` here; only the (more informative) suffix version should
    // survive at that position.
    let atStart = results.filter((r) => r.path.index === 0);
    expect(atStart.length).toBe(1);
    expect(atStart[0].suffix).toBeTruthy();
  });
});

describe('fallbackPathMatchers', () => {
  function firstMatch (line) {
    for (let matcher of fallbackPathMatchers) {
      let match = line.match(matcher);
      if (match?.groups?.path) return match.groups;
    }
    return undefined;
  }

  it('matches a Python-style traceback line', () => {
    let groups = firstMatch('  File "/home/andrew/app/main.py", line 42');
    expect(groups.path).toBe('/home/andrew/app/main.py');
    expect(groups.line).toBe('42');
  });

  it('matches a compiler-style path with (line,col)', () => {
    let groups = firstMatch('C:\\foo\\bar baz.cpp(339,12): error C2065');
    expect(groups.path).toBe('C:\\foo\\bar baz.cpp');
    expect(groups.line).toBe('339');
    expect(groups.col).toBe('12');
  });

  it('matches a clang-style path:line: (single-number form)', () => {
    // The two-number `path:line:col:` form is inherently ambiguous for this
    // greedy pattern (ported as-is from VS Code) when there's no space
    // around the colons — it ends up attributing the middle number to
    // `path` and the last to `line`. That's an accepted upstream quirk;
    // the single-number form is unambiguous and is what most tools that
    // don't include a column actually emit.
    let groups = firstMatch('/foo/bar baz.c:339: error: expected ;');
    expect(groups.path).toBe('/foo/bar baz.c');
    expect(groups.line).toBe('339');
  });

  it('falls back to treating the whole line as a path', () => {
    let groups = firstMatch('/some/path with spaces/file.txt');
    expect(groups.path).toBe('/some/path with spaces/file.txt');
  });
});
