# terminal package

Terminal emulation in Pulsar.

Uses [XTerm](https://xtermjs.org/) and [`node-pty`](https://github.com/microsoft/node-pty).

Inspiration taken from [`x-terminal-reloaded`](https://github.com/Spiker985/x-terminal-reloaded), [`atom-community/terminal`](https://github.com/atom-community/terminal), and all their predecessors.

## Theming

This package supports multiple approaches to theming:

### Stylesheet variables

The ideal way to theme your terminal is via stylesheet variables, since this makes it possible for syntax themes to define the right colors themselves. If your syntax theme doesn’t define these variables, you can use the default fallbacks or define your own in your user stylesheet.

These are the default values as defined in `terminal-variables.less`:

```less
// The ordinary text color of the terminal.
@terminal-text-color: @syntax-text-color;
// The background color of the terminal.
@terminal-background-color: @syntax-background-color;
// The background color of a selected text block.
@terminal-selection-background-color: @syntax-selection-color;
// The text color of selected text.
@terminal-selection-text-color: @syntax-text-color;
// The color of the cursor.
@terminal-cursor-color: @syntax-cursor-color;

// The color of the outline around a “find” result when it is inactive.
@terminal-result-marker-color: @syntax-result-marker-color;
// The color of the outline around a “find” result when it is active.
@terminal-result-marker-color-selected: @syntax-result-marker-color-selected;

// ANSI colors in regular and “bright” variants.
@terminal-color-black: #2e3436;
@terminal-color-red: #cc0000;
@terminal-color-green: #4e9a06;
@terminal-color-yellow: #c4a000;
@terminal-color-blue: #3465a4;
@terminal-color-magenta: #75507b;
@terminal-color-cyan: #06989a;
@terminal-color-white: #d3d7cf;
@terminal-color-bright-black: #555753;
@terminal-color-bright-red: #ef2929;
@terminal-color-bright-green: #8ae234;
@terminal-color-bright-yellow: #fce94f;
@terminal-color-bright-blue: #729fcf;
@terminal-color-bright-magenta: #ad7fa8;
@terminal-color-bright-cyan: #34e2e2;
@terminal-color-bright-white: #eeeeec;
```

### Configuration

If you prefer, you can define the colors explicitly via configuration. The collapsed **Custom Theme Colors** section in the package settings lets you customize each color via color picker.

Be sure to swtich the **Color Theme** setting to **Config** in order for these colors to be used.

### Legacy Themes

All other values in the **Color Theme** list are specific terminal themes with hard-coded values. These themes are included because they were present in this package’s predecessors (`x-terminal`, etc.), but they are not comprehensive; most only define foreground and background text colors and otherwise rely on XTerm’s default ANSI colors.

## Note

This is beta software, and will continue to be beta software until it ships as a built-in package in Pulsar.
